import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import * as dotenv from 'dotenv'
dotenv.config()

const app = express()
app.use(express.json())

const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

app.get('/', (req, res) => res.send('Sofia IA rodando!'))

app.post('/whatsapp', async (req, res) => {
  res.sendStatus(200)
  const body = req.body
  console.log('Evento:', body?.event)

  try {
    if (body?.event !== 'messages.upsert') return

    const data = body?.data
    const fromMe = data?.key?.fromMe
    if (fromMe) { console.log('Mensagem própria'); return }

    const numero = data?.key?.remoteJid
    const texto = data?.message?.conversation ||
                  data?.message?.extendedTextMessage?.text ||
                  data?.message?.imageMessage?.caption
    
    console.log('Numero:', numero)
    console.log('Texto:', texto)
    if (!texto || !numero) { console.log('Sem texto ou numero'); return }

    const { data: cliente, error: errCliente } = await supabase
      .from('clientes')
      .upsert(
        { numero, clinica_id: process.env.CLINICA_ID },
        { onConflict: 'clinica_id,numero' }
      )
      .select().single()

    if (errCliente) { console.log('Erro cliente:', errCliente.message); return }
    console.log('Cliente ok:', cliente.id)

    await supabase.from('conversas').insert({
      cliente_id: cliente.id, papel: 'user', mensagem: texto
    })

    const { data: historico } = await supabase
      .from('conversas')
      .select('papel, mensagem')
      .eq('cliente_id', cliente.id)
      .order('criado_em', { ascending: false })
      .limit(10)

    const mensagens = (historico || []).reverse().map(m => ({
      role: m.papel, content: m.mensagem
    }))

    const resposta = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: process.env.SYSTEM_PROMPT,
      messages: mensagens
    })

    const textoResposta = resposta.content[0].text
    console.log('Resposta:', textoResposta)

    await supabase.from('conversas').insert({
      cliente_id: cliente.id, papel: 'assistant', mensagem: textoResposta
    })

    await axios.post(
      `${process.env.EVOLUTION_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE}`,
      { number: numero, text: textoResposta },
      { headers: { apikey: process.env.EVOLUTION_KEY } }
    )
    console.log('Enviado com sucesso!')

  } catch (e) {
    console.error('ERRO:', e.message)
  }
})

app.listen(process.env.PORT || 3000, () => console.log('Sofia no ar!'))
