import React from "react";

// Public page (no login) — linked from the Google Play listing and the
// mobile app. Keep CONTACT_EMAIL in sync with the real support mailbox.
const CONTACT_EMAIL = "support@hqepl.com";
const LAST_UPDATED = "21 October 2026";

const Section = ({ title, children }) => (
  <section className="mt-8">
    <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
    <div className="mt-2 space-y-2 text-slate-700 leading-relaxed">{children}</div>
  </section>
);

export default function PrivacyPolicy() {
  document.title = "Privacy Policy | Indo OEE";

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm p-6 sm:p-10">
        <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="mt-1 text-sm text-slate-500">Indo OEE · Last updated: {LAST_UPDATED}</p>

        <p className="mt-6 text-slate-700 leading-relaxed">
          Indo OEE (the "App") is a production data entry and OEE (Overall Equipment
          Effectiveness) monitoring tool provided by HQEPL ("we", "us") for use by its
          employees and authorised personnel. This policy explains what information the App
          handles and how it is used.
        </p>

        <Section title="1. Information we collect">
          <p>Accounts are created by a company administrator. The App handles:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Account details: name, login ID / email, role and department.</li>
            <li>
              Production data you enter: machine, process, item, operator, shift, quantities,
              downtime and related records.
            </li>
            <li>
              Files and photos you choose to attach to a record (only when you select them;
              the App does not read your gallery or camera in the background).
            </li>
            <li>
              Basic technical and audit information, such as login times and the actions
              performed in the App, used for security and record keeping.
            </li>
          </ul>
          <p>
            We do not collect your location, contacts, microphone input, or advertising
            identifiers.
          </p>
        </Section>

        <Section title="2. How we use information">
          <ul className="list-disc pl-6 space-y-1">
            <li>To authenticate you and control what you can access.</li>
            <li>To record production activity and calculate OEE, availability, performance and quality.</li>
            <li>To show dashboards, reports and notifications to authorised users.</li>
            <li>To maintain security, prevent misuse and troubleshoot problems.</li>
          </ul>
          <p>We do not use your information for advertising and we do not sell it.</p>
        </Section>

        <Section title="3. Sharing">
          <p>
            Data entered in the App is visible only to authorised users of HQEPL according to
            their role. We do not share it with third parties, except service providers that
            host our servers on our behalf, or where required by law.
          </p>
        </Section>

        <Section title="4. Data storage and security">
          <p>
            Data is transmitted over HTTPS (encrypted in transit) and stored on servers
            controlled by HQEPL. Sign-in credentials on your device are kept in the platform's
            secure storage. Access is limited by role-based permissions.
          </p>
        </Section>

        <Section title="5. Data retention and deletion">
          <p>
            Production records are kept for as long as needed for business and compliance
            purposes. Because accounts are created and managed by your company administrator,
            you can ask for your account to be corrected or deleted by contacting your
            administrator or us at the address below. Some records may be retained where
            required for audit or legal reasons.
          </p>
        </Section>

        <Section title="6. Children">
          <p>The App is intended for working adults and is not directed at children under 18.</p>
        </Section>

        <Section title="7. Changes to this policy">
          <p>
            We may update this policy from time to time. The latest version is always available
            on this page, with the date above updated.
          </p>
        </Section>

        <Section title="8. Contact us">
          <p>
            Questions or requests about this policy or your data:{" "}
            <a className="text-blue-600 underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </p>
        </Section>
      </div>
    </div>
  );
}
