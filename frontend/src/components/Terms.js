import './Auth.css';

function Terms({ onClose }) {
  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Terms and Conditions">
      <div className="auth-backdrop" onClick={onClose} />

      <div className="auth-card" style={{maxWidth: 720}}>
        <button
          className="auth-close-btn"
          onClick={onClose}
          aria-label="Close terms"
          title="Close"
        >
          ✕
        </button>

        <h2 className="auth-title">Terms and Conditions</h2>

        <div style={{maxHeight: '60vh', overflow: 'auto', padding: '8px 0'}}>
          <p><strong>Welcome to Group1 travel planner.</strong></p>
          <p>By using this service you agree to the following terms and conditions. This is a short placeholder; please replace with your official terms before production.</p>
          <h4>1. Use of service</h4>
          <p>The service provides route planning and travel-related information for Lancaster, Preston, Blackpool and surrounding areas. Information is provided as-is and may change.</p>
          <h4>2. Data</h4>
          <p>We may process your account details, route searches, and location data to provide the service. See our privacy policy for details.</p>
          <h4>3. Liability</h4>
          <p>We are not responsible for inaccuracies in third-party data, delays, or travel disruptions. Use your judgement when following suggested routes.</p>
          <h4>4. Changes</h4>
          <p>We may update these terms; continued use indicates acceptance.</p>
          <p style={{marginTop: 12}}>For a full legal document, please add the official terms text to this component or link to an external document.</p>
        </div>

        <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 12}}>
          <button className="auth-submit-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default Terms;
