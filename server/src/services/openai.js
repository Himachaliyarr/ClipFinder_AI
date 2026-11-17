export function getChatCompletionsUrl() {
  let baseUrl = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (/^https:\/\/api\.openai\.com$/i.test(baseUrl)) baseUrl += '/v1';
  return `${baseUrl}/chat/completions`;
}
