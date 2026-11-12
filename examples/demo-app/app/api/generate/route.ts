import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const { goal } = await req.json();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: `Break this goal into tasks: ${goal}` }],
  });
  return Response.json({ plan: completion.choices[0].message.content });
}
