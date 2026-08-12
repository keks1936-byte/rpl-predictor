import { NextRequest, NextResponse } from 'next/server'

function normalizeSecret(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256)
}

export async function GET(req: NextRequest) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN
    const rawSecret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!token) return NextResponse.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is missing' }, { status: 500 })
    if (!rawSecret) return NextResponse.json({ ok: false, error: 'TELEGRAM_WEBHOOK_SECRET is missing' }, { status: 500 })

    const secret = normalizeSecret(rawSecret)
    if (!secret) return NextResponse.json({ ok: false, error: 'TELEGRAM_WEBHOOK_SECRET becomes empty after normalization' }, { status: 500 })

    const origin = new URL(req.url).origin
    const webhookUrl = `${origin}/api/telegram`

    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: ['message', 'callback_query']
      })
    })

    const data = await res.json()
    return NextResponse.json({
      ok: res.ok && data?.ok === true,
      webhook: webhookUrl,
      telegram: data
    }, { status: res.ok ? 200 : 500 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ ok: false, error: 'Webhook setup failed' }, { status: 500 })
  }
}
