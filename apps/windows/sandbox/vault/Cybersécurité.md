# Cybersécurité

```quiz-blocks
[
  // ── 1. SINGLE CHOICE ──────────────────────────────────────────────────────
  {
    id: 'demo-1',
    title: 'Single Choice',
    prompt: 'You receive an email from your bank asking you to click a link and confirm your password urgently. What should you do?',
    options: [
      'Click the link and enter your credentials quickly before it expires',
      'Reply to the email asking if it is legitimate',
      'Go directly to your bank website by typing the URL yourself',
      'Forward the email to friends to warn them',
    ],
    correctIndex: 2,
    hint: 'Legitimate banks never ask for your password by email. The safest move avoids the link entirely.',
    explainHtml: '<p>This is a classic <strong>phishing</strong> attack. The email creates urgency to make you act without thinking.</p><ul><li>Never click links in suspicious emails — always type the URL directly in your browser.</li><li>Real banks will never ask for your password via email.</li><li>Replying or forwarding still interacts with the attacker.</li></ul><p>When in doubt, call your bank directly using the number on the back of your card.</p>',
  },

  // ── 2. MULTIPLE CHOICE ────────────────────────────────────────────────────
  {
    id: 'demo-2',
    title: 'Multiple Choice',
    prompt: 'Which of the following are good habits for a strong password? (Select all that apply)',
    options: [
      'Use a different password for every account',
      'Include your date of birth for easy recall',
      'Use a mix of uppercase, lowercase, numbers, and symbols',
      'Use a password manager to store them',
      'Reuse your strongest password on all important sites',
    ],
    multiSelect: true,
    correctIndices: [0, 2, 3],
    hint: 'Personal info and reuse are the two biggest weaknesses. A manager removes the need to remember.',
    explainHtml: '<p>Password security is one of the most impactful habits you can build.</p><ul><li><strong>Different password per account</strong> ✓ — if one site is breached, others stay safe.</li><li><em>Date of birth</em> ✗ — trivially guessable from social media.</li><li><strong>Mix of characters</strong> ✓ — dramatically increases the number of possible combinations.</li><li><strong>Password manager</strong> ✓ — lets you use strong unique passwords without memorizing them.</li><li><em>Reusing passwords</em> ✗ — one breach exposes all your accounts.</li></ul>',
  },

  // ── 3. TEXT INPUT ─────────────────────────────────────────────────────────
  {
    id: 'demo-3',
    title: 'Text Answer',
    prompt: 'In a URL like "https://bank.example.com", what is the part that guarantees the connection is encrypted?',
    type: 'text',
    placeholder: 'Enter the protocol prefix...',
    acceptedAnswers: ['https', 'HTTPS'],
    caseSensitive: false,
    hint: 'Look at the very beginning of the URL — it is one letter longer than the unencrypted version.',
    explainHtml: '<p><strong>HTTPS</strong> (HyperText Transfer Protocol Secure) means the connection between your browser and the server is encrypted using TLS.</p><p>The padlock icon in your browser confirms HTTPS is active. Never enter passwords or card numbers on a plain <code>http://</code> site.</p>',
  },
]
```
