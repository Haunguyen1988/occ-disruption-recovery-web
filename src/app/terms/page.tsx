import React from 'react';

export default function TermsOfService() {
  return (
    <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold mb-8">Terms of Service</h1>
      <p className="mb-4">Last updated: {new Date().toLocaleDateString()}</p>
      
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">1. Acceptance of Terms</h2>
        <p>By using the OCC Disruption Recovery tool, you agree to comply with these Terms of Service.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">2. Use License</h2>
        <p>This is an internal tool for airline operational use only. Unauthorized distribution or use outside the intended scope is prohibited.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">3. Disclaimer</h2>
        <p>The tool provides decision support based on available data. Final operational decisions remain the responsibility of the Duty Manager.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">4. Limitations</h2>
        <p>In no event shall the developers be liable for any damages arising out of the use or inability to use the tool.</p>
      </section>
    </div>
  );
}
