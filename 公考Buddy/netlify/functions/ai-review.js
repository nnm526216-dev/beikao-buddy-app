const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MODEL = 'deepseek-v4-flash';

const SYSTEM_PROMPT = `你是一位资深的公务员考试申论阅卷老师。请根据题目和学生的作答进行专业点评。

请严格按以下 JSON 格式回复，不要包含 markdown 代码块或其他多余文字：
{
  "score": 0到100的整数,
  "summary": "一句话总评",
  "strengths": ["优点1", "优点2"],
  "improvements": ["改进建议1", "改进建议2", "改进建议3"],
  "detailed": "详细点评，约200字，涵盖立意、结构、论证、语言表达等方面"
}`;

function parseReview(content) {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : content);
  } catch {
    return {
      score: null,
      summary: content.slice(0, 120),
      strengths: [],
      improvements: [],
      detailed: content,
    };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: '仅支持 POST 请求' }),
    };
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: '服务端未配置 DEEPSEEK_API_KEY 环境变量' }),
    };
  }

  let question, answer;
  try {
    const body = JSON.parse(event.body || '{}');
    question = (body.question || '').trim();
    answer = (body.answer || '').trim();
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: '请求体格式错误' }),
    };
  }

  if (!question) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: '请提供题目（question）' }),
    };
  }

  if (!answer) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: '请提供作答内容（answer）' }),
    };
  }

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `【题目】\n${question}\n\n【学生作答】\n${answer}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
        thinking: { type: 'disabled' },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data.error?.message || data.message || `DeepSeek API 错误 (${res.status})`;
      return {
        statusCode: res.status >= 500 ? 502 : 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: msg }),
      };
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return {
        statusCode: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'AI 未返回有效内容' }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ review: parseReview(content) }),
    };
  } catch (err) {
    console.error('ai-review error:', err);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: '服务暂时不可用，请稍后重试' }),
    };
  }
};
