import './Auth.css';

function Terms({ onClose }) {
  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Terms and Conditions">
      <div className="auth-backdrop" onClick={onClose} />

      <div className="auth-card" style={{maxWidth: 820}}>
        <button
          className="auth-close-btn"
          onClick={onClose}
          aria-label="Close terms"
          title="Close"
        >
          ✕
        </button>

        <h2 className="auth-title">Terms and Conditions</h2>

        <div style={{maxHeight: '65vh', overflow: 'auto', padding: '8px 0'}}>
          <p><strong>Effective date:</strong> 16/06/2026</p>
          <p><strong>Introduction.</strong> These Terms and Conditions ("Terms") govern your use of the "Go Lancs" route planner provided by [Emily Birtwhistle, Mo Eskandari, Lewis Byles, Tom Davies, Oliver Khan-Hayes, Turhan Zaim]. By creating an account, signing in, or using the Service you agree to these Terms. If you do not agree, do not use the Service.</p>

          <h4>Definitions</h4>
          <p><strong>Service:</strong> the web and mobile-accessible travel route planner covering Lancaster, Preston, Blackpool, the Fylde and Wyre coast, including frontend, backend, APIs, map, and weather displays.</p>
          <p><strong>User / You:</strong> any person who accesses or uses the Service.</p>
          <p><strong>Content:</strong> data, information, maps, routes, weather, live-vehicle tracking, and any other material shown by the Service.</p>

          <h4>Scope of Service</h4>
          <p>We provide route suggestions using bus, rail, road and walking options, weather information from third-party providers, and live/real-time transport feeds. The Service is provided for personal, non-commercial use unless otherwise agreed in writing.</p>

          <h4>Account Registration and Acceptance</h4>
          <p>You must provide accurate registration details and keep them updated. By signing up you accept these Terms and our Privacy Policy and consent to processing necessary personal data. The sign-up UI presents a link to these Terms; users should be able to view them before completing registration.</p>

          <h4>User Obligations and Acceptable Use</h4>
          <p>Do not use the Service to attempt unauthorised access, reverse-engineer the backend, or interfere with other users. Do not upload illegal content or use the Service for unlawful purposes. You are responsible for securing your account credentials.</p>

          <h4>Data, Location & Live Tracking</h4>
          <p>With your permission we may collect location data to provide routing and tracking features. You may disable location sharing in your device or account settings. Live vehicle data and train departures are obtained from third parties. We do not guarantee the accuracy or completeness of third-party live feeds.</p>

          <h4>Third-Party Data and APIs</h4>
          <p>The Service aggregates third-party data (transport timetables, live feeds, weather APIs). Those third-party providers retain their own terms and disclaimers. We do not control these providers and are not responsible for errors, omissions, or interruptions in their services.</p>

          <h4>Accuracy & Reliance</h4>
          <p>Route suggestions, travel times, delays, and weather are estimates. Always exercise caution when travelling. We are not liable for outcomes resulting from following Service suggestions (e.g., missed connections, delays, accidents).</p>

          <h4>Availability & Maintenance</h4>
          <p>We aim to keep the Service available but may suspend or restrict access for maintenance, upgrades, or security reasons. We are not liable for downtime.</p>

          <h4>Intellectual Property</h4>
          <p>All Service code, UI, logos, and original content are our property or licensed to us. You may not copy, modify, or redistribute them except where expressly permitted. You retain ownership of personal content you upload, but grant us a licence to use it to provide the Service.</p>

          <h4>Points, Rewards & Transactions</h4>
          <p>Any rewards or points offered are subject to separate rules; we reserve the right to modify, suspend or cancel rewards. Points have no cash value unless expressly stated.</p>

          <h4>Fees & Payments</h4>
          <p>The Service is currently free to use. If fees are introduced, they will be communicated and will require your explicit acceptance.</p>

          <h4>Termination & Suspension</h4>
          <p>We may suspend or terminate accounts that breach these Terms or where required by law. On termination you lose access to account features; some data may be retained as required for legal or operational reasons.</p>

          <h4>Limitation of Liability & Disclaimer</h4>
          <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOSS OF DATA, REVENUE OR PROFITS ARISING OUT OF YOUR USE OF THE SERVICE. Our aggregate liability for direct loss will not exceed £100 (or another local currency equivalent), except where legislation requires otherwise.</p>

          <h4>Indemnity</h4>
          <p>You agree to indemnify and hold us harmless from any claims resulting from your misuse of the Service, violation of these Terms, or unlawful conduct.</p>

          <h4>Privacy & Data Protection</h4>
          <p>Our Privacy Policy explains how we collect, use, store and share personal data. By using the Service you consent to those policies. You may request access, correction, or deletion of your personal data as provided in the Privacy Policy and applicable law.</p>

          <h4>Children</h4>
          <p>The Service is not targeted at children under 18. If a minor uses the Service, parental consent and supervision may be required.</p>

          <h4>Changes to the Service or Terms</h4>
          <p>We may update the Service and these Terms. We will notify users of material changes; continued use after notice constitutes acceptance of the changes.</p>

          <h4>Governing Law & Disputes</h4>
          <p>These Terms are governed by the laws of [England and Wales]. Disputes should first be attempted to be resolved by informal negotiation, then via the courts of that jurisdiction if unresolved.</p>

          <h4>Severability</h4>
          <p>If any provision of these Terms is found invalid or unenforceable, the remainder stays in force.</p>

          <h4>Contact & Notices</h4>
          <p>For questions about these Terms or the Service, contact: [Emily Birtwhistle, Lewis Byles, Tom Davies, Mo Eskandari, Oliver Khan-Hayes, Turhan Zaim] — [e.birtwhistle@lancaster.ac.uk, l.byles@lancaster.ac.uk, t.davies7@lancaster.ac.uk, m.eskandari@lancaster.ac.uk, o.khan-hayes@lancaster.ac.uk, t.zaim@lancaster.ac.uk] in respective order.</p>

          <h4>Acceptance UI</h4>
          <p>On sign-up present: "By creating an account I agree to the Terms and Conditions" with "Terms and Conditions" linking to this modal/page. Consider adding a checkbox that must be ticked before submission for explicit consent.</p>

          <h4>Project-specific notes</h4>
          <p>Services run inside Podman containers with backend ports in range 5000–5100. Personal data is stored in PostgreSQL. Live transport feeds and weather data are provided by third parties and accuracy depends on them.</p>

        </div>

        <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 12}}>
          <button className="auth-submit-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default Terms;
