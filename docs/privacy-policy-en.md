# Ascuita Privacy Policy

**Last updated: July 16, 2026**

This Privacy Policy describes how Ascuita ("the Service", "we", "us") collects, uses, and protects the personal information of users ("you", "the User") when using the Ascuita web or mobile application.

The data controller responsible for personal data is **David Valencia**, who can be contacted at **contacto@davidvalencia.site**.

By creating an account or using the Service, you agree to the practices described in this Privacy Policy.

---

## 1. Information We Collect

### 1.1. Authentication information

When you sign in with your Google account through Firebase Authentication, we collect and store:

- **Email address**
- **Display name** from your Google account
- **Profile photo URL** from Google
- **Email verification status**
- **Authentication provider** (Google)

### 1.2. User-generated content

When using the Service, you may create and store:

- **Custom agents**: name, personality, body color, and selected voice.
- **Conversations**: records of conversations held with AI agents, including agent identifier, start and end dates, and message count.
- **Messages**: transcribed text of your messages (automatically transcribed voice input) and the AI agent's responses.
- **Profile and persistent memories**: your preferred name, optional information you provide about yourself, and, for authenticated users, brief non-sensitive memories that the agent considers useful for future conversations. Automatic memories are enabled by default and can be disabled from Settings. Memories are stored as separate records with categories and creation/update dates.

### 1.3. Real-time audio data

The Service streams your voice in real time to the backend, which forwards it to the Google Gemini Live API to generate responses. On Android, this feature requires microphone permission and is only active during a conversation session. This audio is **not permanently stored** on our servers; it is processed transiently during the active session and discarded upon completion.

### 1.4. Technical and usage data

- **IP address**: used for security, rate limiting, and abuse prevention. Temporarily stored in security logs with configurable retention (default: 3 days).
- **Analytics data**: Firebase Analytics collects aggregated and anonymized data about Service usage (events, sessions, device, browser, approximate location).
- **Standard HTTP headers**: browser type, operating system, preferred language.

### 1.5. Unauthenticated user data (free trial)

If you use the Service without signing in, we collect:

- **IP address**: to control the free trial duration (3 minutes by default) and prevent abuse.
- **Real-time audio**: streamed to the Gemini Live API in the same manner as authenticated users.

No conversation content or memories are stored for unauthenticated users. Guests also receive no local memory storage.

---

## 2. How We Use Your Information

We use the collected information to:

- **Provide the Service**: authenticate users, store and retrieve conversations, agents, and memories, and process AI interactions.
- **Personalize conversations**: use brief non-sensitive memories across sessions to adapt responses when automatic memories are enabled. They are enabled by default for authenticated users, but can be disabled from Settings. The model decides when to request a memory, but the application validates the request before saving it.
- **Improve the Service**: analyze usage patterns through Firebase Analytics to identify areas for improvement.
- **Ensure security**: prevent abuse, enforce rate limiting, detect and block malicious IPs, and maintain security logs.
- **Communicate with you**: respond to inquiries, notify you of important changes to the Service or this Policy.

We do not sell, rent, or trade your personal information to third parties.

---

## 3. Legal Basis for Processing (GDPR)

For users in the European Union, data processing is based on:

- **Consent** (Art. 6(1)(a) GDPR): where required by law and validly obtained for personalization and memories.
- **Performance of a contract** (Art. 6(1)(b) GDPR): to provide the Service's functionality.
- **Legitimate interest** (Art. 6(1)(f) GDPR): for security, abuse prevention, and analytics, and for personalization where applicable and properly balanced.

The default activation of memories and general acceptance of this Policy explain this functionality, but do not replace any specific consent that applicable law may require.

---

## 4. Sharing Information with Third Parties

We share data with the following service providers, under their respective privacy policies:

### 4.1. Google Firebase

- **Firebase Authentication**: manages Google authentication.
- **Cloud Firestore**: stores user data, agents, conversations, messages, and memories.
- **Firebase Analytics**: collects aggregated usage data.
- Google Privacy Policy: [https://policies.google.com/privacy](https://policies.google.com/privacy)

### 4.2. Google Gemini Live API

- Processes real-time audio and text to generate AI agent responses. When memories are enabled, memory context may be sent as part of a session's system instructions.
- Data sent to Gemini is governed by Google Cloud's privacy policy.
- Gemini Privacy: [https://ai.google.dev/privacy](https://ai.google.dev/privacy)

### 4.3. Backend hosting provider

- The backend is hosted on a VPS that processes WebSocket connections.
- The user's IP address is processed on the server for security and rate limiting.

We do not share personal information with any other third party, except as required by law.

---

## 5. Data Retention

| Data type | Retention period |
|---|---|
| User account (Auth) | Until the user requests deletion |
| Custom agents | Until the user deletes them or requests account deletion |
| Conversations and messages | Until the user deletes them or requests account deletion |
| Persistent memories | Until the user deletes them or requests account deletion |
| Security logs (IP) | 3 days (configurable, default) |
| Free trial data (IP) | 1 hour after trial start |
| Analytics data | Per Firebase Analytics retention policy |

You may delete your account and all associated data from Settings or through [the external account deletion page](https://ascuita.web.app/eliminar-cuenta). You may also write to **contacto@davidvalencia.site**.

---

## 6. Your Rights (GDPR and CCPA)

If you reside in the European Union (GDPR) or California (CCPA), you have the following rights:

- **Access**: request a copy of your personal data.
- **Rectification**: request correction of inaccurate data.
- **Erasure**: request deletion of your personal data ("right to be forgotten").
- **Memory controls**: view, export, or delete memories in Settings, and disable automatic saving.
- **Restriction**: request that we limit the processing of your data.
- **Portability**: receive your data in a structured, transferable format.
- **Objection**: object to the processing of your data based on legitimate interest.
- **Withdrawal of consent**: at any time, without affecting the legality of prior processing.

To exercise these rights, write to **contacto@davidvalencia.site**.

---

## 7. Security

We implement the following security measures:

- **Protected API key**: the Gemini Live API key is never exposed to the browser; the backend acts as a proxy.
- **Rate limiting**: limits on HTTP requests, WebSocket connections, concurrent connections per IP, and audio bytes per time window.
- **Temporary IP blocking**: IPs that exceed limits are temporarily blocked.
- **Security headers**: nosniff, DENY frame, strict referrer policy, same-site CORP, microphone permission restriction.
- **Token verification**: the backend verifies Firebase Auth tokens before allowing data access.
- **Firestore rules**: each user can only access their own data, including their memories.
- **Data minimization**: the application limits memory size, categories, and content, and rejects especially sensitive types of information.

Despite these measures, no system is 100% secure. We cannot guarantee the absolute security of your data.

---

## 8. International Transfers

Your data is processed on Google servers (Firebase, Gemini) and on a VPS that may be located outside your country of residence. By using the Service, you consent to the international transfer of your data under the conditions of the service providers.

Google participates in data transfer frameworks such as the EU-U.S. Data Privacy Framework.

---

## 9. Cookies and Similar Technologies

The Service uses Firebase Analytics, which may employ cookies or local storage to collect usage data. You can manage cookies through your browser settings.

We do not use advertising or third-party tracking cookies.

---

## 10. Children's Privacy

The Service is intended for users aged **13 or older**. We do not knowingly collect personal information from children under 13.

If you are a parent or guardian and believe a child under 13 has provided personal data, please contact us at **contacto@davidvalencia.site** to have such information removed.

---

## 11. Links to Third-Party Sites

The Service may contain links to third-party websites. We are not responsible for the privacy practices of those sites. We recommend reviewing their privacy policies.

---

## 12. Changes to This Privacy Policy

We may update this Privacy Policy at any time. We will notify significant changes through a notice in the Service or by email. The "Last updated" date at the top indicates the current version.

---

## 13. Contact

For any questions, requests, or exercise of rights regarding this Privacy Policy, contact:

- **Email**: contacto@davidvalencia.site
- **Responsible**: David Valencia

---

*By using Ascuita, you confirm that you have read and accepted this Privacy Policy.*
