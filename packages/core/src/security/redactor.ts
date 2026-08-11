export class SecretRedactor {
  private static readonly PATTERNS = [
    // Basic heuristics for obvious secrets
    /(sk-ant-api03-[a-zA-Z0-9\-_]{40,})/g, // Anthropic API Key
    /(sk-[a-zA-Z0-9]{48})/g, // OpenAI API Key
    /(ghp_[a-zA-Z0-9]{36})/g, // GitHub Personal Access Token
    /(AKIA[0-9A-Z]{16})/g, // AWS Access Key
    /-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g, // Private Key Blocks
    /eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/g, // JWTs
    /(?:password|secret|token|api_key|apikey|access_token)[\s:=]+['"]?([a-zA-Z0-9\-_=+]{10,})['"]?/gi, // Generic assignment
  ];

  static redact(text: string): string {
    if (!text) return text;
    let redacted = text;
    for (const pattern of this.PATTERNS) {
      redacted = redacted.replace(pattern, '[REDACTED_SECRET]');
    }
    return redacted;
  }
}
