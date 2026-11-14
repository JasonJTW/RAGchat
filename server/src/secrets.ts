import { lintSource } from "@secretlint/core";
import { creator as recommended } from "@secretlint/secretlint-rule-preset-recommend";
import type { SecretLintRuleCreator } from "@secretlint/types";

// 密鑰 (ADR-0004): an input that holds a password or an API key is refused
// whole, never pseudonymised, so the secret reaches no model and no table.
// secretlint's recommended rules know the vendors' token formats; ours add
// what people type in a chat: 「密碼是 …」, `API_KEY=…` and the key prefixes
// the recommended rules miss outside a config file.

const PATTERNS = [
  // A password given with its value. The value must hold an ASCII character,
  // so 「密碼：請洽管理員」 is no password.
  /(?:密碼|密码|口令|password|passwd|pwd|passcode)\s*(?:是|為|为|[:：=])\s*["'「]?(?=[^\s"'」]*[\x21-\x7e])[^\s"'」]{4,}/i,
  // A key or token assigned its value.
  /(?:api[_\s-]?key|secret[_\s-]?key|access[_\s-]?token|auth[_\s-]?token|金鑰|密鑰)\s*(?:是|為|[:：=])\s*["']?[A-Za-z0-9_\-./+=]{16,}/i,
  /\bsk-(?:proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const chatSecrets: SecretLintRuleCreator = {
  messages: { FOUND: { en: () => "found a secret" } },
  meta: {
    id: "ragchat/chat-secrets",
    type: "scanner",
    recommended: true,
    supportedContentTypes: ["text"],
  },
  create(context) {
    const t = context.createTranslator(chatSecrets.messages);
    return {
      file(source) {
        for (const pattern of PATTERNS) {
          const match = pattern.exec(source.content);
          if (match)
            context.report({
              message: t("FOUND"),
              range: [match.index, match.index + match[0].length],
            });
        }
      },
    };
  },
};

/** The reply to an input refused for a secret. */
export const SECRET_REFUSAL =
  "這則內容含有密碼或 API key，為了安全沒有送出，也沒有存進知識庫。請把密鑰移除後再試一次。";

/** Whether the text holds a password, an API key or another secret. */
export async function containsSecret(text: string): Promise<boolean> {
  if (!text.trim()) return false;
  const result = await lintSource({
    source: {
      content: text,
      filePath: "/input.txt",
      ext: ".txt",
      contentType: "text",
    },
    options: {
      config: {
        rules: [
          {
            id: "@secretlint/secretlint-rule-preset-recommend",
            rule: recommended,
          },
          { id: chatSecrets.meta.id, rule: chatSecrets },
        ],
      },
    },
  });
  return result.messages.length > 0;
}
