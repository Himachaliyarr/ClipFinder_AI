import { config } from '../config/settings.js';

export function getChatCompletionsUrl() {
  let baseUrl = config.llmBaseUrl.replace(/\/+$/, '');
  if (/^https:\/\/api\.openai\.com$/i.test(baseUrl)) baseUrl += '/v1';
  return `${baseUrl}/chat/completions`;
}
