import React from 'react';

export default function PrivacyPolicy() {
  return (
    <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>
      <p className="mb-4">Last updated: {new Date().toLocaleDateString()}</p>
      
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">1. Introduction</h2>
        <p>This Privacy Policy explains how OCC Disruption Recovery collects, uses, and protects your information when you use our internal tool.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">2. Data Collection</h2>
        <p>We collect operational data related to flight schedules, aircraft status, and disruption events. This data is used solely for decision support and recovery planning.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">3. Data Security</h2>
        <p>We implement industry-standard security measures to protect your data from unauthorized access or disclosure.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">4. Contact Us</h2>
        <p>If you have any questions about this Privacy Policy, please contact the OCC technical team.</p>
      </section>
    </div>
  );
}
