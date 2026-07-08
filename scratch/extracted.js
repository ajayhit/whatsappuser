
    // App State
    let state = {
      token: localStorage.getItem('token') || null,
      user: null,
      plan: null,
      plans: [],
      orders: [],
      transactions: [],
      whatsappStatus: 'DISCONNECTED',
      whatsappQr: null,
      whatsappAccount: null,
      groups: [],
      currentTab: 'whatsappTab',
      whatsappSubTab: 'textTab',
      publicPage: 'home',
      authTab: 'login',
      loading: false,
      
      // Dynamic lists fetched on profile sync
      banks: [],
      planPrice: 149,
      
      // Admin-only caches
      adminBanks: [],
      adminUsers: [],
      adminOrders: [],
      editingBankId: null, // used if editing a bank account
      forgotResetStep: 'email', // 'email' | 'otp' | 'done'
      forgotEmail: '',
      forgotOtp: '',
      captchaId: null,
      captchaQuestion: 'Loading...',
      captchaImage: '',
      
      // Bulk campaign state
      bulkTasks: [],
      bulkCampaignStatus: 'idle', // 'idle' | 'sending' | 'paused' | 'stopped' | 'completed'
      bulkCampaignIndex: 0,
      bulkDelay: 2
    };

    let statusPollInterval = null;

    // Main App Renderer
    function renderApp() {
      const root = document.getElementById('appRoot');
      if (!state.token) {
        if (state.publicPage === 'auth') {
          root.innerHTML = renderAuthScreen();
          bindAuthEvents();
        } else {
          root.innerHTML = renderPublicSite();
        }
      } else {
        root.innerHTML = renderMainDashboard();
        bindDashboardEvents();
        syncSubTabState();
      }
    }

    // PUBLIC WEBSITE TEMPLATES
    function switchPublicPage(page) {
      state.publicPage = page;
      renderApp();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showAuth(tab = 'login') {
      state.publicPage = 'auth';
      state.authTab = tab;
      renderApp();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function renderPublicSite() {
      return `
        <div class="site-shell">
          ${renderSiteNav()}
          ${renderPublicPage()}
          ${renderSiteFooter()}
        </div>
      `;
    }

    function renderSiteNav() {
      const links = [
        ['home', 'Home'],
        ['about', 'About&nbsp;Us'],
        ['contact', 'Contact'],
        ['refund', 'Refund&nbsp;Policy'],
        ['privacy', 'Privacy'],
        ['terms', 'Terms']
      ];
      return `
        <nav class="site-nav">
          <button class="site-logo" onclick="switchPublicPage('home')" style="background:none; border:none; cursor:pointer; text-align:left;">
            WhatsApp Messaging
            <span>Studio & SaaS Panel</span>
          </button>
          <div class="site-links">
            ${links.map(([page, label]) => `<button class="site-link ${state.publicPage === page ? 'active' : ''}" onclick="switchPublicPage('${page}')">${label}</button>`).join('')}
          </div>
          <div class="site-actions">
            <button type="button" class="btn-secondary" onclick="showAuth('login')" style="width:auto;">Login</button>
            <button type="button" onclick="showAuth('register')" style="width:auto;">Sign&nbsp;Up</button>
          </div>
        </nav>
      `;
    }

    function renderPublicPage() {
      if (state.publicPage === 'about') return renderAboutPage();
      if (state.publicPage === 'contact') return renderContactPage();
      if (state.publicPage === 'refund') return renderRefundPolicyPage();
      if (state.publicPage === 'privacy') return renderPrivacyPolicyPage();
      if (state.publicPage === 'terms') return renderTermsPage();
      return renderHomePage();
    }

    function renderHomePage() {
      return `
        <section class="site-hero">
          <div class="site-hero-content">
            <div class="site-kicker">WhatsApp Messaging for business teams</div>
            <h1>Manage messaging, campaigns, contacts, and subscriptions from one secure dashboard.</h1>
            <p>Run WhatsApp sessions, send bulk messages, parse Excel contact lists, track plan access, and manage payments from a clean SaaS panel built for daily operations.</p>
            <div class="site-hero-actions">
              <button type="button" onclick="showAuth('register')" style="width:auto; padding:0.8rem 1.2rem;">Create Account</button>
              <button type="button" class="btn-secondary" onclick="showAuth('login')" style="width:auto; padding:0.8rem 1.2rem;">Login</button>
            </div>
          </div>
        </section>

        <section class="site-band">
          <div class="site-grid">
            <div class="site-panel">
              <i class="fa-solid fa-message"></i>
              <h3>WhatsApp Studio</h3>
              <p>Connect a session, view live status, and manage text, media, group, and campaign workflows from the user dashboard.</p>
            </div>
            <div class="site-panel">
              <i class="fa-solid fa-file-excel"></i>
              <h3>Excel Campaigns</h3>
              <p>Upload recipient spreadsheets, personalize messages with columns, and prepare bulk delivery without manually copying numbers.</p>
            </div>
            <div class="site-panel">
              <i class="fa-solid fa-shield-halved"></i>
              <h3>Secure Signup</h3>
              <p>New users pass a visual security challenge before registration, with server-side verification and expiring one-time captcha codes.</p>
            </div>
             <div class="site-panel">
  <i class="fa-solid fa-chart-line"></i>
  <h3>Grow Your Business</h3>
  <p>Increase customer engagement with smart WhatsApp Messaging. Schedule campaigns, reach thousands of contacts, and improve communication with a simple and secure platform.</p>
</div>
          </div>
        </section>
      `;
    }

   function renderAboutPage() {
  return `
    <section class="policy-page">
      <div class="site-kicker">About Us</div>

      <h1>Empowering Businesses with Smart WhatsApp Messaging</h1>

      <p>
        We are committed to helping businesses communicate faster, smarter, and
        more efficiently through powerful WhatsApp Messaging solutions. Our
        platform is designed to simplify customer engagement, automate repetitive
        messaging tasks, and improve business productivity—all from one secure
        and easy-to-use dashboard.
      </p>

      <p>
        Whether you're a startup, growing business, agency, or enterprise, our
        platform enables you to manage conversations, send personalized bulk
        campaigns, organize customer contacts, and streamline communication
        without unnecessary complexity.
      </p>

      <div class="site-grid">

        <div class="site-panel">
          <i class="fa-solid fa-bolt"></i>
          <h3>Powerful Messaging</h3>
          <p>
            Automate repetitive WhatsApp tasks, schedule campaigns, and send
            personalized messages in just a few clicks, saving valuable time
            every day.
          </p>
        </div>

        <div class="site-panel">
          <i class="fa-solid fa-users"></i>
          <h3>Built for Every Business</h3>
          <p>
            Perfect for retailers, service providers, educational institutes,
            healthcare, marketing agencies, and businesses of every size looking
            to improve customer communication.
          </p>
        </div>

        <div class="site-panel">
          <i class="fa-solid fa-shield-halved"></i>
          <h3>Secure & Reliable</h3>
          <p>
            We prioritize security and reliability by protecting user accounts,
            maintaining secure sessions, and providing a stable messaging
            environment for daily operations.
          </p>
        </div>

        <div class="site-panel">
          <i class="fa-solid fa-chart-line"></i>
          <h3>Business Growth</h3>
          <p>
            Reach more customers, improve engagement, increase response rates,
            and build stronger customer relationships using intelligent WhatsApp
            communication tools.
          </p>
        </div>

      </div>

      <h2 style="margin-top:25px;">Why Choose Us?</h2>

      <p>
        Our mission is to provide a modern, reliable, and feature-rich WhatsApp
        Messaging platform that helps businesses save time, reduce manual work,
        and improve customer engagement. With an intuitive interface, continuous
        improvements, and scalable solutions, we empower organizations to focus
        on what matters most—growing their business.
      </p>

      <p>
        From individual entrepreneurs to large organizations, we strive to
        deliver a professional communication platform that combines simplicity,
        performance, and security into one complete solution.
      </p>
    </section>
  `;
}
    
   function renderContactPage() {
  return `
    <section class="policy-page">
      <div class="site-kicker">Contact Us</div>

      <h1>We're Here to Help</h1>

      <p>
        Our support team is committed to providing fast, reliable, and professional
        assistance for all your questions related to account setup, subscriptions,
        payments, and WhatsApp Messaging services.
      </p>

      <p>
        Whether you need technical support, billing assistance, or have general
        inquiries, we're always happy to help. Our goal is to ensure you have the
        best experience using our platform.
      </p>

      <div class="site-grid">

        <div class="site-panel">
          <i class="fa-solid fa-envelope"></i>
          <h3>Email Support</h3>
          <p>
            support@yourdomain.com
          </p>
          <small style="color:var(--text-muted);">
            We typically respond within 24 business hours.
          </small>
        </div>

        <div class="site-panel">
          <i class="fa-solid fa-phone"></i>
          <h3>Phone Support</h3>
          <p>
            +91 XXXXX XXXXX
          </p>
          <small style="color:var(--text-muted);">
            Monday to Saturday<br>
            10:00 AM – 6:00 PM (IST)
          </small>
        </div>

        <div class="site-panel">
          <i class="fa-brands fa-whatsapp"></i>
          <h3>WhatsApp Support</h3>
          <p>
            +91 XXXXX XXXXX
          </p>
          <small style="color:var(--text-muted);">
            Get quick assistance through WhatsApp.
          </small>
        </div>

        <div class="site-panel">
          <i class="fa-solid fa-location-dot"></i>
          <h3>Office Address</h3>
          <p>
            Your Company Name<br>
            Your City, State<br>
            India
          </p>
        </div>

      </div>

      <h2 style="margin-top:30px;">Business Hours</h2>

      <p>
        <strong>Monday – Saturday:</strong> 10:00 AM – 6:00 PM (IST)<br>
        <strong>Sunday:</strong> Closed
      </p>

      <h2 style="margin-top:25px;">Support Information</h2>

      <p>
        For faster assistance, please include your registered email address,
        transaction reference number (if applicable), and a brief description of
        your issue when contacting our support team.
      </p>

      <div style="
          margin-top:25px;
          padding:20px;
          background:rgba(16,185,129,.08);
          border:1px solid rgba(16,185,129,.2);
          border-radius:12px;
          text-align:center;">
        <h3 style="margin-bottom:10px;">Need Immediate Assistance?</h3>
        <p style="margin-bottom:15px;">
          Our support team is ready to help you with technical issues,
          subscriptions, payments, and account-related queries.
        </p>
        <button onclick="showAuth('login')" style="width:auto;padding:12px 28px;">
          Login to Your Account
        </button>
      </div>
    </section>
  `;
}
   
   function renderRefundPolicyPage() {
  return `
    <section class="policy-page">
      <div class="site-kicker">Refund & Cancellation Policy</div>

      <h1>Refund and Cancellation Policy</h1>

      <p>
        Thank you for choosing our WhatsApp Messaging Platform. We are committed
        to providing reliable software services and transparent billing. Please
        read our Refund and Cancellation Policy carefully before purchasing any
        subscription plan.
      </p>

      <h2>1. Subscription Purchase</h2>
      <p>
        All subscription plans provide access to our software services for the
        selected validity period. By purchasing a subscription, you agree to the
        terms outlined in this policy.
      </p>

      <h2>2. No Refund After Purchase</h2>
      <ul>
        <li>Once a subscription has been successfully purchased and activated, it cannot be cancelled.</li>
        <li>No refund will be provided after activation of the subscription.</li>
        <li>Please review the plan details carefully before making your payment.</li>
      </ul>

      <h2>3. Cancellation Policy</h2>
      <ul>
        <li>Purchased subscription plans are non-cancellable.</li>
        <li>Users may stop using the service at any time, but the subscription fee will not be refunded.</li>
        <li>The subscription will remain active until its expiry date.</li>
      </ul>

      <h2>4. Refund Eligibility</h2>
      <p>
        Refunds will only be considered under the following circumstances:
      </p>

      <ul>
        <li>The platform is completely unavailable due to our server-side issues for an extended period.</li>
        <li>Technical issues originating from our systems prevent activation or use of the purchased service.</li>
        <li>The purchased subscription cannot be activated due to a verified issue on our server.</li>
        <li>Duplicate payments made accidentally for the same subscription may be reviewed for refund after verification.</li>
      </ul>

      <h2>5. Refund Not Applicable</h2>
      <ul>
        <li>Change of mind after purchasing the subscription.</li>
        <li>Lack of knowledge about software features.</li>
        <li>User device, internet connection, or browser-related issues.</li>
        <li>WhatsApp restrictions, bans, policy changes, or limitations imposed by Meta.</li>
        <li>Incorrect usage or misuse of the platform.</li>
      </ul>

      <h2>6. Refund Processing</h2>
      <p>
        If a refund request is approved after verification, the amount will be
        processed through the original payment method within <strong>5 to 7
        business days</strong>, depending on your bank or payment provider.
      </p>

      <h2>7. Contact for Refund Requests</h2>
      <p>
        If you believe you are eligible for a refund due to a verified server-side
        issue, please contact our support team with your registered email address,
        payment reference number, and a detailed description of the issue.
      </p>

      <div style="
        margin-top:30px;
        padding:20px;
        background:rgba(245,158,11,.08);
        border:1px solid rgba(245,158,11,.25);
        border-radius:12px;">
        <h3 style="margin-bottom:12px;">
          <i class="fa-solid fa-circle-info"></i>
          Important Notice
        </h3>

        <ul style="margin-left:20px;">
          <li><strong>Once a subscription is purchased and activated, it cannot be cancelled.</strong></li>
          <li><strong>No refund will be provided after successful activation of the service.</strong></li>
          <li><strong>Refunds are only applicable if the service cannot be provided due to verified server-side or system-related issues from our platform.</strong></li>
        </ul>
      </div>
    </section>
  `;
}
    
   function renderPrivacyPolicyPage() {
  return `
    <section class="policy-page">
      <div class="site-kicker">Privacy Policy</div>

      <h1>Privacy Policy</h1>

      <p>
        Your privacy is important to us. This Privacy Policy explains how we
        collect, use, store, and protect your personal information when you use
        our WhatsApp Messaging Platform and related services.
      </p>

      <h2>1. Information We Collect</h2>
      <p>We may collect the following information when you use our platform:</p>

      <ul>
        <li>Full Name</li>
        <li>Email Address</li>
        <li>Mobile Number</li>
        <li>Account credentials (stored securely in encrypted form)</li>
        <li>Subscription and payment details</li>
        <li>Transaction reference numbers and payment screenshots</li>
        <li>Usage logs required to operate and improve our services</li>
      </ul>

      <h2>2. How We Use Your Information</h2>
      <p>Your information is used only for legitimate business purposes, including:</p>

      <ul>
        <li>Creating and managing your account.</li>
        <li>Processing subscriptions and payments.</li>
        <li>Providing customer support.</li>
        <li>Managing WhatsApp Messaging services.</li>
        <li>Improving platform performance and security.</li>
        <li>Sending important service notifications and account updates.</li>
      </ul>

      <h2>3. Data Security</h2>
      <p>
        We implement reasonable technical and administrative security measures
        to protect your personal information against unauthorized access,
        disclosure, alteration, or destruction.
      </p>

      <h2>4. Data Sharing</h2>
      <p>
        We respect your privacy. We do <strong>not sell, rent, or trade</strong>
        your personal information to third parties.
      </p>

      <p>Your information may only be shared when:</p>

      <ul>
        <li>Required by applicable law or government authorities.</li>
        <li>Necessary to process payments through authorized payment providers.</li>
        <li>Required to protect our legal rights or prevent fraud and misuse.</li>
      </ul>

      <h2>5. Payment Information</h2>
      <p>
        Payment transactions are processed through authorized banking or payment
        partners. We do not store your debit card, credit card, or banking
        passwords on our servers.
      </p>

      <h2>6. Cookies & Session Data</h2>
      <p>
        Our website may use cookies and session data to improve user experience,
        maintain secure login sessions, and analyze platform performance.
      </p>

      <h2>7. User Responsibilities</h2>
      <ul>
        <li>Keep your account credentials confidential.</li>
        <li>Do not share your login details with unauthorized persons.</li>
        <li>Notify our support team immediately if you suspect unauthorized access to your account.</li>
      </ul>

      <h2>8. Policy Updates</h2>
      <p>
        We may update this Privacy Policy from time to time to reflect changes
        in our services, legal requirements, or security practices. The latest
        version will always be available on this website.
      </p>

      <h2>9. Contact Us</h2>
      <p>
        If you have any questions regarding this Privacy Policy or how your data
        is handled, please contact our support team through the Contact Us page.
      </p>

      <div style="
        margin-top:30px;
        padding:20px;
        background:rgba(16,185,129,.08);
        border:1px solid rgba(16,185,129,.2);
        border-radius:12px;">
        <h3 style="margin-bottom:12px;">
          <i class="fa-solid fa-shield-halved"></i>
          Our Privacy Commitment
        </h3>

        <ul style="margin-left:20px;">
          <li>Your personal information is kept secure.</li>
          <li>We never sell or rent your personal data.</li>
          <li>Your information is used only to provide and improve our services.</li>
          <li>We continuously work to protect your account and data using industry-standard security practices.</li>
        </ul>
      </div>
    </section>
  `;
}
   
   function renderTermsPage() {
  return `
    <section class="policy-page">
      <div class="site-kicker">Terms & Conditions</div>

      <h1>Terms and Conditions</h1>

      <p>
        Welcome to our WhatsApp Messaging Platform. By registering an account,
        purchasing a subscription, or using our services, you agree to comply
        with these Terms and Conditions. If you do not agree with any part of
        these terms, please do not use our platform.
      </p>

      <h2>1. Acceptance of Terms</h2>
      <p>
        By accessing or using this platform, you acknowledge that you have read,
        understood, and agreed to be bound by these Terms and Conditions, our
        Privacy Policy, and our Refund & Cancellation Policy.
      </p>

      <h2>2. User Account</h2>
      <ul>
        <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
        <li>You are responsible for all activities performed using your account.</li>
        <li>You must provide accurate and up-to-date registration information.</li>
        <li>Sharing or transferring your account to another person is strictly prohibited.</li>
      </ul>

      <h2>3. Subscription & Payments</h2>
      <ul>
        <li>All subscription plans are prepaid.</li>
        <li>Service access is activated only after successful payment verification.</li>
        <li>Subscriptions are valid for the selected plan duration.</li>
        <li>Once a subscription has been activated, it cannot be cancelled or refunded except as described in our Refund Policy.</li>
      </ul>

      <h2>4. Acceptable Use</h2>
      <p>Users agree not to use the platform for:</p>

      <ul>
        <li>Sending spam or unsolicited bulk messages.</li>
        <li>Fraudulent, illegal, abusive, or misleading activities.</li>
        <li>Distributing malware, phishing links, or harmful content.</li>
        <li>Violating WhatsApp or Meta policies.</li>
        <li>Any activity that may damage the platform or other users.</li>
      </ul>

      <h2>5. WhatsApp Service Disclaimer</h2>
      <p>
        Our platform operates with WhatsApp services. We are not affiliated with,
        endorsed by, or operated by WhatsApp LLC or Meta Platforms, Inc.
      </p>

      <p>
        Changes made by WhatsApp or Meta, including API changes, policy updates,
        account restrictions, or service limitations, may affect platform
        functionality. We are not responsible for such third-party changes.
      </p>

      <h2>6. Service Availability</h2>
      <p>
        We strive to provide reliable service. However, temporary interruptions
        may occur due to maintenance, software updates, internet connectivity,
        server maintenance, or third-party service outages.
      </p>

      <h2>7. Suspension or Termination</h2>
      <p>We reserve the right to suspend or permanently terminate accounts that:</p>

      <ul>
        <li>Violate these Terms and Conditions.</li>
        <li>Attempt unauthorized access to the platform.</li>
        <li>Use the platform for illegal or harmful activities.</li>
        <li>Cause security risks or abuse the service.</li>
      </ul>

      <h2>8. Limitation of Liability</h2>
      <p>
        We shall not be liable for any indirect, incidental, or consequential
        damages arising from the use or inability to use the platform, including
        business loss, data loss, message delivery delays, or third-party service
        interruptions.
      </p>

      <h2>9. Changes to the Service</h2>
      <p>
        We reserve the right to modify, improve, suspend, or discontinue any
        feature or service without prior notice whenever necessary.
      </p>

      <h2>10. Changes to These Terms</h2>
      <p>
        These Terms and Conditions may be updated periodically. Continued use of
        the platform after any changes constitutes acceptance of the revised terms.
      </p>

      <h2>11. Contact</h2>
      <p>
        If you have any questions regarding these Terms and Conditions, please
        contact our support team through the Contact Us page.
      </p>

      <div style="
        margin-top:30px;
        padding:20px;
        background:rgba(59,130,246,.08);
        border:1px solid rgba(59,130,246,.2);
        border-radius:12px;">

        <h3 style="margin-bottom:12px;">
          <i class="fa-solid fa-circle-check"></i>
          Important Notice
        </h3>

        <ul style="margin-left:20px;">
          <li>Use the platform responsibly and in compliance with all applicable laws.</li>
          <li>Do not use the service for spam, fraud, or unauthorized messaging.</li>
          <li>Subscriptions are non-transferable and intended for the registered account only.</li>
          <li>Once a subscription is activated, it is governed by our Refund & Cancellation Policy.</li>
          <li>Violation of these terms may result in immediate suspension or permanent termination of your account.</li>
        </ul>

      </div>
    </section>
  `;
}
    function renderSiteFooter() {
      return `
        <footer class="site-footer">
          <span>© ${new Date().getFullYear()} WhatsApp Messaging Studio. All rights reserved.</span>
          <span>Home | About Us | Privacy Policy | Terms | Refund Policy | Contact</span>
        </footer>
      `;
    }

    // AUTH TEMPLATES
    function renderAuthScreen() {
      const isReset = state.authTab === 'forgot';
      return `
        <div class="site-shell">
          ${renderSiteNav()}
          <div class="auth-container" style="margin-top: 1rem;">
            <div class="auth-tabs">
              <button class="auth-tab ${state.authTab === 'login' ? 'active' : ''}" id="loginTabBtn">Sign In</button>
              <button class="auth-tab ${state.authTab === 'register' ? 'active' : ''}" id="registerTabBtn">Sign Up</button>
              <button class="auth-tab ${state.authTab === 'forgot' ? 'active' : ''}" id="forgotTabBtn">Reset</button>
            </div>
            <div class="auth-card">
              <div class="auth-header">
                <h2>WhatsApp Messaging Studio</h2>
                <p>${state.authTab === 'login' ? 'Sign in to access your dashboard' : state.authTab === 'register' ? 'Create an account to start automating' : 'Reset your account password'}</p>
              </div>
              
              <div id="authAlert" style="display: none; background: rgba(244, 63, 94, 0.15); border: 1px solid var(--error-color); padding: 0.75rem; border-radius: 8px; font-size: 0.85rem; color: var(--error-color); margin-bottom: 1rem; text-align: center;"></div>
              <div id="authSuccess" style="display: none; background: rgba(16, 185, 129, 0.15); border: 1px solid var(--accent-color); padding: 0.75rem; border-radius: 8px; font-size: 0.85rem; color: var(--accent-color); margin-bottom: 1rem; text-align: center;"></div>
              
              ${state.authTab === 'login' ? renderLoginForm() : state.authTab === 'register' ? renderRegisterForm() : renderForgotPasswordForm()}
            </div>
          </div>
          ${renderSiteFooter()}
        </div>
      `;
    }

    function renderLoginForm() {
      return `
        <form id="loginForm" onsubmit="handleLogin(event)" style="display: flex; flex-direction: column; gap: 1rem;">
          <div class="form-group">
            <label>Email Address</label>
            <input type="email" id="loginEmail" required placeholder="name@domain.com">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="loginPassword" required placeholder="••••••••">
          </div>
          <button type="submit" style="margin-top: 1rem;">Sign In</button>
          <div style="text-align: center; margin-top: 0.25rem;">
            <a href="#" onclick="event.preventDefault(); switchAuthTab('forgot')" style="color: var(--info-color); font-size: 0.85rem; text-decoration: none;">Forgot your password?</a>
          </div>
        </form>
      `;
    }

    function renderRegisterForm() {
      return `
        <form id="registerForm" onsubmit="handleRegister(event)" style="display: flex; flex-direction: column; gap: 1rem;">
          <div class="form-group">
            <label>Full Name</label>
            <input type="text" id="regName" required placeholder="John Doe">
          </div>
          <div class="form-group">
            <label>Email Address</label>
            <input type="email" id="regEmail" required placeholder="john@example.com">
          </div>
          <div class="form-group">
            <label>Phone Number</label>
            <input type="tel" id="regPhone" placeholder="e.g. 919876543210">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="regPassword" required placeholder="Minimum 6 characters">
          </div>
          <div class="form-group">
            <label>Security Challenge</label>
            <div style="display: grid; grid-template-columns: 1fr auto; gap: 0.6rem; align-items: stretch;">
              <div id="captchaVisualBox" style="background: rgba(15, 23, 42, 0.72); border: 1px solid var(--glass-border); border-radius: 10px; padding: 0.5rem; min-height: 82px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                ${state.captchaImage
                  ? `<img id="captchaImage" src="${state.captchaImage}" alt="Signup security code" style="width: 100%; max-width: 260px; height: 92px; object-fit: contain; display: block;">`
                  : `<div id="captchaQuestion" style="color: var(--accent-color); font-weight: 700;">${state.captchaQuestion}</div>`}
              </div>
              <button type="button" onclick="loadCaptcha()" class="btn-secondary" title="Refresh captcha" aria-label="Refresh captcha" style="width: 46px; padding: 0.65rem; display: flex; align-items: center; justify-content: center;">
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
              </button>
            </div>
            <input type="text" id="regCaptchaAnswer" required autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="10" placeholder="Type the code shown above" style="text-transform: uppercase; letter-spacing: 0.18em; font-weight: 700;">
          </div>
          <button type="submit" style="margin-top: 1rem;">Sign Up</button>
        </form>
      `;
    }

    function renderForgotPasswordForm() {
      if (state.forgotResetStep === 'done') {
        return `
          <div style="display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 1rem 0;">
            <div style="font-size: 2.5rem;">✅</div>
            <div style="font-weight: 600; font-size: 1.1rem; color: var(--accent-color);">Password Reset Successful!</div>
            <p style="color: var(--text-muted); font-size: 0.9rem; text-align: center;">Your password has been updated. You can now sign in with your new password.</p>
            <button onclick="state.forgotResetStep = 'email'; switchAuthTab('login')" style="margin-top: 0.5rem;">Go to Sign In</button>
          </div>
        `;
      }

      if (state.forgotResetStep === 'otp') {
        return `
          <form id="resetPasswordForm" onsubmit="handleResetPassword(event)" style="display: flex; flex-direction: column; gap: 1rem;">
            <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); padding: 0.75rem; border-radius: 8px; font-size: 0.85rem; color: var(--info-color); text-align: center;">
              A 6-digit OTP has been generated for <strong>${state.forgotEmail}</strong>. Enter it below.
            </div>
            <div class="form-group">
              <label>6-Digit OTP Code</label>
              <input type="text" id="resetOtp" required placeholder="Enter 6-digit code" maxlength="6" pattern="[0-9]{6}" style="text-align: center; letter-spacing: 0.5em; font-size: 1.2rem; font-weight: 700;">
            </div>
            <div class="form-group">
              <label>New Password</label>
              <input type="password" id="resetNewPassword" required placeholder="Minimum 6 characters">
            </div>
            <div class="form-group">
              <label>Confirm New Password</label>
              <input type="password" id="resetConfirmPassword" required placeholder="Re-enter new password">
            </div>
            <button type="submit" style="margin-top: 0.5rem;">Reset Password</button>
            <div style="text-align: center;">
              <a href="#" onclick="event.preventDefault(); state.forgotResetStep = 'email'; renderApp();" style="color: var(--text-muted); font-size: 0.85rem; text-decoration: none;">← Back to email entry</a>
            </div>
          </form>
        `;
      }

      // Default: email entry step
      return `
        <form id="forgotPasswordForm" onsubmit="handleForgotPassword(event)" style="display: flex; flex-direction: column; gap: 1rem;">
          <div style="font-size: 0.9rem; color: var(--text-muted); line-height: 1.5;">
            Enter the email address linked to your account. We'll generate a one-time password reset code.
          </div>
          <div class="form-group">
            <label>Email Address</label>
            <input type="email" id="forgotEmail" required placeholder="your.email@domain.com">
          </div>
          <button type="submit" style="margin-top: 0.5rem;">Send Reset Code</button>
          <div style="text-align: center;">
            <a href="#" onclick="event.preventDefault(); switchAuthTab('login')" style="color: var(--text-muted); font-size: 0.85rem; text-decoration: none;">← Back to Sign In</a>
          </div>
        </form>
      `;
    }

    // MAIN DASHBOARD TEMPLATE (Swaps based on User/Admin Role)
    function renderMainDashboard() {
      if (!state.user) {
        fetchUserProfile();
        return `<div style="text-align: center; padding: 4rem;">Loading details...</div>`;
      }

      const isAdmin = state.user.role === 'admin';

      if (isAdmin) {
        return renderAdminDashboard();
      } else {
        return renderUserDashboard();
      }
    }

    // USER DASHBOARD
    function renderPlanCards() {
      if (!state.planOptions || state.planOptions.length === 0) {
        return '<div style="text-align: center; color: var(--text-muted);">No plans available</div>';
      }
      return state.planOptions.map(function(plan) {
        const isDemo = plan.type === 'demo';
        let btnText = isDemo ? 'Claim Demo (10d)' : 'Subscribe Now';
        let btnClass = isDemo ? 'btn-secondary' : '';
        let btnAttrs = '';
        const alreadyClaimedDemo = isDemo && state.plans && state.plans.some(function(p) { return p.plan_type === 'demo'; });
        if (alreadyClaimedDemo) {
          btnText = 'Trial Claimed';
          btnClass = 'btn-secondary';
          btnAttrs = 'disabled style="opacity:0.5;cursor:not-allowed;"';
        }
        const borderColor = isDemo ? 'rgba(59,130,246,0.25)' : 'var(--glass-border)';
        const nameColor = isDemo ? '#60a5fa' : 'var(--text-main)';
        return '<div class="card" style="margin:0;background:rgba(15,23,42,0.4);border:1px solid ' + borderColor + ';display:flex;flex-direction:column;justify-content:space-between;gap:1rem;padding:1rem;border-radius:10px;">'
          + '<div style="display:flex;flex-direction:column;gap:0.3rem;">'
          + '<div style="font-weight:700;font-size:0.95rem;color:' + nameColor + ';">' + plan.name + '</div>'
          + '<div style="font-size:0.75rem;color:var(--text-muted);">' + plan.durationDays + ' Days Duration</div>'
          + '<div style="font-size:1.4rem;font-weight:800;color:var(--accent-color);margin-top:0.4rem;">\u20b9' + plan.price + '</div>'
          + '</div>'
          + '<button type="button" class="' + btnClass + '" ' + btnAttrs + ' onclick="purchasePlan(\'' + plan.type + '\',' + plan.price + ',' + plan.durationDays + ')" style="width:100%;font-size:0.8rem;padding:0.4rem 0.8rem;margin:0;">'
          + btnText
          + '</button>'
          + '</div>';
      }).join('');
    }

    function renderUserDashboard() {
      const hasActivePlan = state.plan && state.plan.status === 'active' && new Date(state.plan.expires_at) > new Date();
      const planCardsHtml = renderPlanCards();
      const activeBadge = hasActivePlan ? '<span style="font-size:0.75rem;font-weight:normal;color:var(--accent-color);background:rgba(16,185,129,0.1);border:1px solid var(--accent-color);padding:0.2rem 0.6rem;border-radius:9999px;letter-spacing:0.05em;">SUBSCRIPTION ACTIVE</span>' : '';

      return `
        <header>
          <div class="brand">
            <h1>WhatsApp Messaging User Studio</h1>
            <p>Control Panel & Subscription Portal</p>
          </div>
          <div class="user-profile">
            <div class="user-details">
              <div class="user-name">${state.user.name}</div>
              <div class="user-role">SUBSCRIBER</div>
            </div>
            <button class="btn-logout" onclick="handleLogout()">Sign Out</button>
          </div>
        </header>

        ${!hasActivePlan ? `
          <div class="service-banner">
            <div style="font-size: 1.5rem;">⚠️</div>
            <div>
              <div class="service-banner-title">WhatsApp Messaging Locked — Subscription Expired or Inactive</div>
              <div class="service-banner-desc">You do not have an active ₹${state.planPrice} / 28-day plan. Access to WhatsApp Session connections and APIs is currently suspended. Please transfer funds and submit payment reference details below.</div>
            </div>
          </div>
        ` : ''}

        <div class="app-layout">
          <!-- Sidebar: Billing, Wallet & Plan -->
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            <!-- Plan & Wallet Card -->
            <div class="card">
              <div class="card-title">
                <span>Account & Plan</span>
              </div>
              <div class="wallet-box">
                <label>Wallet Balance</label>
                <div class="wallet-amount">₹${state.user.wallet_balance.toFixed(2)}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">Used for plan auto-activation</div>
              </div>
              
              <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--glass-border);">
                <span style="font-size: 0.85rem; color: var(--text-muted);">Plan Status</span>
                ${hasActivePlan 
                  ? `<span class="badge badge-active">Active</span>` 
                  : (state.orders.some(o => o.status === 'pending') 
                      ? `<span class="badge badge-pending">Review Pending</span>` 
                      : `<span class="badge badge-expired">Inactive</span>`
                    )
                }
              </div>

              ${hasActivePlan ? `
                <div style="font-size: 0.8rem; color: var(--text-muted); text-align: center;">
                  Expires on: <strong style="color: var(--warning-color);">${new Date(state.plan.expires_at).toLocaleDateString()}</strong><br>
                  (${Math.ceil((new Date(state.plan.expires_at) - new Date()) / (1000 * 60 * 60 * 24))} days remaining)
                </div>
              ` : ''}
            </div>

            <!-- Dynamic Bank Accounts List -->
            <div class="card">
              <div class="card-title">
                <span>Payment Bank Options</span>
              </div>
              <p style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.4;">
                Transfer <strong>₹${state.planPrice}</strong> to any of the verified bank accounts listed below to recharge:
              </p>
              
              <div class="bank-card-list">
                ${state.banks.length === 0 ? '<div style="font-size:0.85rem; text-align:center; color:var(--error-color);">No bank accounts available. Contact Admin.</div>' : 
                  state.banks.map(bank => `
                    <div class="bank-item">
                      <div class="bank-details-row">
                        <span>Bank Name</span>
                        <span>${bank.bank_name}</span>
                      </div>
                      <div class="bank-details-row">
                        <span>Account Number</span>
                        <span><code>${bank.account_number}</code></span>
                      </div>
                      <div class="bank-details-row">
                        <span>IFSC Code</span>
                        <span><code>${bank.ifsc}</code></span>
                      </div>
                      <div class="bank-details-row">
                        <span>Holder Name</span>
                        <span>${bank.account_holder}</span>
                      </div>
                    </div>
                  `).join('')
                }
              </div>
            </div>

            <!-- Submit Deposit form -->
            <div class="card">
              <div class="card-title">Submit Deposit Reference</div>
              <form id="orderForm" onsubmit="handleOrderSubmit(event)" style="display: flex; flex-direction: column; gap: 0.85rem;">
                <div class="form-group">
                  <label>Select Bank Sent To</label>
                  <select id="orderBankSelect" required>
                    <option value="">-- Choose destination bank --</option>
                    ${state.banks.map(b => `<option value="${b.id}">${b.bank_name} - ${b.account_holder}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label>Purpose / Plan to Buy</label>
                  <select id="orderPlanTypeSelect" onchange="handleOrderPlanSelectChange(this)" required>
                    <option value="wallet">Just recharge wallet (Add funds)</option>
                    ${state.planOptions ? state.planOptions.filter(p => p.type !== 'demo').map(p => `
                      <option value="${p.type}">${p.name} - ₹${p.price} (${p.durationDays} Days)</option>
                    `).join('') : ''}
                  </select>
                </div>
                <div class="form-group">
                  <label>Deposit Amount (₹)</label>
                  <input type="number" id="orderAmountInput" required min="1" placeholder="Enter amount sent" value="199">
                </div>
                <div class="form-group">
                  <label>Sender Account Name</label>
                  <input type="text" id="orderAccountName" required placeholder="Name on bank statement">
                </div>
                <div class="form-group">
                  <label>Transaction UTR / Reference No.</label>
                  <input type="text" id="orderUtr" required placeholder="12-digit UTR Code">
                </div>
                <div class="form-group">
                  <label>Upload Screenshot (Optional)</label>
                  <input type="file" id="orderScreenshot" accept="image/*,application/pdf" style="background:none; border:none; padding: 0.25rem 0;">
                </div>
                <button type="submit">Submit Deposit Request</button>
              </form>
            </div>
          </div>

          <!-- Main Panel Content -->
          <div class="card">
            <div class="tabs-nav">
              <button class="tab-btn ${state.currentTab === 'whatsappTab' ? 'active' : ''}" onclick="switchTab('whatsappTab')">WhatsApp Studio</button>
              <button class="tab-btn ${state.currentTab === 'ordersTab' ? 'active' : ''}" onclick="switchTab('ordersTab')">Order History</button>
              <button class="tab-btn ${state.currentTab === 'userExpiryReportTab' ? 'active' : ''}" onclick="switchTab('userExpiryReportTab')">Expiry Report</button>
              <button class="tab-btn ${state.currentTab === 'apiDocsTab' ? 'active' : ''}" onclick="switchTab('apiDocsTab')">API Docs</button>
              <button class="tab-btn ${state.currentTab === 'changePasswordTab' ? 'active' : ''}" onclick="switchTab('changePasswordTab')">Account Settings</button>
            </div>

            <!-- TAB: WhatsApp Studio -->
            <div id="whatsappTab" class="tab-content ${state.currentTab === 'whatsappTab' ? 'active' : ''}">
              
              <!-- Plan Pricing Cards Grid -->
              <div style="margin-bottom: 1.5rem; background: rgba(255,255,255,0.01); border: 1px solid var(--glass-border); padding: 1.25rem; border-radius: 12px;">
                <div style="font-weight: 600; font-size: 1.05rem; margin-bottom: 1rem; color: #a5b4fc; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                  <span style="display: flex; align-items: center; gap: 0.5rem;">💎 Choose a Subscription Plan</span>
                  ${activeBadge}
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">
                  ${planCardsHtml}
                </div>
              </div>

              ${!hasActivePlan ? `
                <div style="text-align: center; padding: 3rem 2rem; color: var(--text-muted); background: rgba(255,255,255,0.01); border: 1px solid var(--glass-border); border-radius: 12px;">
                  <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🔒</div>
                  <h3>WhatsApp Automation Features are Locked</h3>
                  <p style="margin-top: 0.5rem; max-width: 450px; margin-inline: auto; font-size: 0.85rem; line-height: 1.5;">Please claim the Free Demo Plan above, or transfer funds and submit a deposit reference request to unlock full WhatsApp session access and automated APIs.</p>
                </div>
              ` : `
                <div style="display: grid; grid-template-columns: 1fr; gap: 1.5rem;">
                  <!-- WhatsApp Session Status Card -->
                  <div style="display: flex; flex-direction: column; gap: 1rem; background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 12px; border: 1px solid var(--glass-border);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span style="font-weight: 600;">WhatsApp Session Connection</span>
                      <div id="statusBadge" class="badge badge-none">
                        <div class="pulse"></div>
                        <span id="statusText">Disconnected</span>
                      </div>
                    </div>
                    
                    <div style="display: flex; gap: 0.5rem;">
                      <button onclick="triggerLogin()" id="connectSessionBtn" style="flex: 1;">Connect / Reload Session</button>
                      <button onclick="triggerLogout()" id="disconnectSessionBtn" class="btn-danger" style="flex: 1;" disabled>Disconnect & Unlink</button>
                    </div>

                    <div id="qrContainer" class="qr-container">
                      <span style="color: var(--text-muted); font-size: 0.85rem; text-align: center;">
                        Click "Connect / Reload" to start your WhatsApp connection.
                      </span>
                    </div>

                    <div id="profileContainer" class="profile-card" style="display: none;">
                      <img id="profileAvatar" class="profile-avatar" src="https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y" alt="Avatar">
                      <div>
                        <div style="font-weight: 600; font-size: 0.95rem;" id="profileName">Loading Account...</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);" id="profileNumber">Phone: </div>
                      </div>
                    </div>
                  </div>

                  <!-- WhatsApp Actions Console -->
                  <div style="display: flex; flex-direction: column; gap: 1rem;">
                    <div class="tabs-nav" style="border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.85rem;">
                      <button class="tab-btn ${state.whatsappSubTab === 'textTab' ? 'active' : ''}" onclick="switchSubTab('textTab')">Send Message</button>
                      <button class="tab-btn ${state.whatsappSubTab === 'mediaTab' ? 'active' : ''}" onclick="switchSubTab('mediaTab')">Send Media</button>
                      <button class="tab-btn ${state.whatsappSubTab === 'groupsTab' ? 'active' : ''}" onclick="switchSubTab('groupsTab')">Groups</button>
                      <button class="tab-btn ${state.whatsappSubTab === 'lookupTab' ? 'active' : ''}" onclick="switchSubTab('lookupTab')">Profile Lookup</button>
                      <button class="tab-btn ${state.whatsappSubTab === 'bulkTab' ? 'active' : ''}" onclick="switchSubTab('bulkTab')">Bulk (Excel)</button>
                    </div>

                    <!-- Sub Tab: Text Message -->
                    <div id="textTab" class="whatsapp-sub-content tab-content ${state.whatsappSubTab === 'textTab' ? 'active' : ''}">
                      <div class="actions-grid">
                        <div style="display: flex; flex-direction: column; gap: 1rem;">
                          <div class="form-group">
                            <label>Recipient JID or Phone Number</label>
                            <input type="text" id="msgTo" placeholder="e.g. 919876543210 (include country code)">
                          </div>
                          <div class="form-group">
                            <label>Message Content</label>
                            <textarea id="msgBody" rows="4" placeholder="Type message body here..."></textarea>
                          </div>
                          <button onclick="sendMessage()" id="sendMsgBtn" disabled>Send Message</button>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                          <label>API Activity Logs</label>
                          <div id="apiConsole" class="console-card">
                            <div class="console-line system">[System] Logs initialized.</div>
                          </div>
                          <button class="btn-secondary" onclick="clearConsole('apiConsole')">Clear Logs</button>
                        </div>
                      </div>
                    </div>

                    <!-- Sub Tab: Send Media -->
                    <div id="mediaTab" class="whatsapp-sub-content tab-content ${state.whatsappSubTab === 'mediaTab' ? 'active' : ''}">
                      <div class="actions-grid">
                        <div style="display: flex; flex-direction: column; gap: 1rem;">
                          <div class="form-group">
                            <label>Recipient JID or Phone</label>
                            <input type="text" id="mediaTo" placeholder="e.g. 919876543210">
                          </div>
                          <div class="form-group">
                            <label>Media Attachment Type</label>
                            <select id="mediaTypeSelect" onchange="onMediaTypeChange()">
                              <option value="image">Image (JPEG/PNG)</option>
                              <option value="document">Document (PDF/DOCX/xlsx)</option>
                              <option value="audio">Audio (MP3/OGG)</option>
                              <option value="video">Video (MP4)</option>
                            </select>
                          </div>
                          <div class="form-group">
                            <label>Attachment Source</label>
                            <div style="display: flex; gap: 1rem; padding: 0.25rem 0;">
                              <label style="display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.85rem;">
                                <input type="radio" name="mediaSource" value="url" checked onchange="toggleMediaSource('url')" style="width: auto;"> External URL
                              </label>
                              <label style="display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.85rem;">
                                <input type="radio" name="mediaSource" value="file" onchange="toggleMediaSource('file')" style="width: auto;"> Local File Upload
                              </label>
                            </div>
                          </div>
                          <div class="form-group" id="mediaUrlGroup">
                            <label>File URL</label>
                            <input type="text" id="mediaUrl" placeholder="https://domain.com/image.png">
                          </div>
                          <div class="form-group" id="mediaFileGroup" style="display: none;">
                            <label>Upload File</label>
                            <input type="file" id="mediaFile" style="background:none; border:none; padding: 0.25rem 0;">
                          </div>
                          <div class="form-group" id="mediaFileNameGroup" style="display: none;">
                            <label>Filename Override (for documents)</label>
                            <input type="text" id="mediaFileName" placeholder="Leave empty for original name">
                          </div>
                          <div class="form-group" id="mediaCaptionGroup">
                            <label>Caption / Text (Optional)</label>
                            <input type="text" id="mediaCaption" placeholder="Add caption text here...">
                          </div>
                          <button onclick="sendMedia()" id="sendMediaBtn" disabled>Send Media Attachment</button>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                          <label>Media Activity Logs</label>
                          <div id="mediaConsole" class="console-card">
                            <div class="console-line system">[System] Media logs initialized.</div>
                          </div>
                          <button class="btn-secondary" onclick="clearConsole('mediaConsole')">Clear Logs</button>
                        </div>
                      </div>
                    </div>

                    <!-- Sub Tab: Groups -->
                    <div id="groupsTab" class="whatsapp-sub-content tab-content ${state.whatsappSubTab === 'groupsTab' ? 'active' : ''}">
                      <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <button onclick="loadGroups()" class="btn-secondary" style="width: auto; align-self: flex-start;">Fetch Participating Groups</button>
                        <div class="form-group">
                          <label>Select Group</label>
                          <select id="groupSelect" onchange="onGroupSelectChange()">
                            <option value="">-- Fetch groups to select --</option>
                          </select>
                        </div>
                        <div class="form-group">
                          <label>Group Message Text</label>
                          <textarea id="groupMsgBody" rows="3" placeholder="Write message to group..."></textarea>
                        </div>
                        <button onclick="sendGroupMessage()" id="sendGroupMsgBtn" disabled style="width: auto;">Send Message to Group</button>
                      </div>
                    </div>

                    <!-- Sub Tab: Profile Lookup -->
                    <div id="lookupTab" class="whatsapp-sub-content tab-content ${state.whatsappSubTab === 'lookupTab' ? 'active' : ''}">
                      <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <div class="form-group">
                          <label>Lookup Target Phone Number</label>
                          <input type="text" id="lookupPhone" placeholder="e.g. 919876543210 (leave empty for own profile)">
                        </div>
                        <button onclick="lookupProfile()" style="width: auto;">Lookup Profile Avatar & Name</button>
                        
                        <div id="lookupResult" class="profile-card" style="display: none; margin-top: 1rem;">
                          <img id="lookupAvatar" class="profile-avatar" src="https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y" alt="Avatar">
                          <div>
                            <div id="lookupResultPhone" style="font-weight: 600;">Phone: </div>
                            <div id="lookupResultPic" style="font-size: 0.85rem; color: var(--text-muted);">No details found</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Sub Tab: Bulk Messaging (Excel) -->
                    <div id="bulkTab" class="whatsapp-sub-content tab-content ${state.whatsappSubTab === 'bulkTab' ? 'active' : ''}">
                      <div id="bulkConnectionWarning" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #f87171; padding: 0.75rem; border-radius: 8px; font-size: 0.85rem; margin-bottom: 1rem; display: none; align-items: center; gap: 0.5rem; font-weight: 500;">
                        ⚠️ <strong>Connection Error:</strong> WhatsApp session is disconnected. Please connect your session in the "WhatsApp Connection" tab first.
                      </div>
                      <div class="actions-grid">
                        <div style="display: flex; flex-direction: column; gap: 1rem;">
                          <div class="form-group">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                              <label style="margin-bottom: 0;">Upload Excel File (.xlsx, .xls)</label>
                              <a href="/demo_recipients.xlsx" download="demo_recipients.xlsx" style="color: var(--accent-color); font-size: 0.8rem; text-decoration: none; display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 500;">
                                📥 Download Sample Excel
                              </a>
                            </div>
                            <input type="file" id="bulkExcelFile" accept=".xlsx, .xls" style="background:none; border:none; padding: 0.25rem 0;">
                            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">
                              Excel must contain a column named <strong>phone</strong>, <strong>mobile</strong>, or <strong>number</strong>. Placeholders like <code>{name}</code> will be replaced by the row cell data.
                            </div>
                          </div>
                          
                          <div class="form-group">
                            <label>Message Template</label>
                            <textarea id="bulkMsgBody" rows="4" placeholder="Hello {name}, your code is {code}..."></textarea>
                          </div>
                          
                          <div class="form-group">
                            <label>Delay (Seconds)</label>
                            <input type="number" id="bulkDelay" value="2" min="1" max="10" style="max-width: 100px;">
                          </div>

                          <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                            <button onclick="parseExcelFile()" id="parseExcelBtn" style="flex: 1;">Parse & Preview</button>
                            <button onclick="startBulkCampaign()" id="startBulkBtn" style="flex: 1; background: var(--accent-color);" disabled>Send Campaign</button>
                          </div>

                          <div style="display: flex; gap: 0.5rem;">
                            <button onclick="pauseBulkCampaign()" id="pauseBulkBtn" class="btn-secondary" style="flex: 1;" disabled>Pause</button>
                            <button onclick="stopBulkCampaign()" id="stopBulkBtn" class="btn-danger" style="flex: 1;" disabled>Stop/Reset</button>
                          </div>

                          <!-- Campaign Progress Section -->
                          <div id="bulkProgressContainer" style="display: none; background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 8px; border: 1px solid var(--glass-border); margin-top: 0.5rem;">
                            <div id="bulkProgressText" style="font-size: 0.85rem; font-weight: 600; margin-bottom: 0.5rem;">Progress: 0 / 0 sent</div>
                            <div style="background: rgba(255,255,255,0.1); border-radius: 10px; height: 10px; overflow: hidden; width: 100%;">
                              <div id="bulkProgressBar" style="background: var(--accent-color); height: 100%; width: 0%; transition: width 0.3s ease;"></div>
                            </div>
                          </div>

                          <!-- Preview Table Target -->
                          <div id="bulkPreviewContainer"></div>
                        </div>

                        <!-- Bulk Console Logs -->
                        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                          <label>Campaign Activity Console</label>
                          <div id="bulkConsole" class="console-card">
                            <div class="console-line system">[System] Campaign logs initialized.</div>
                          </div>
                          <button class="btn-secondary" onclick="clearConsole('bulkConsole')">Clear Logs</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              `}
            </div>

            <!-- TAB: User Order History -->
            <div id="ordersTab" class="tab-content ${state.currentTab === 'ordersTab' ? 'active' : ''}">
              <div class="card-title">Submitted Deposit History</div>
              
              <!-- Filters Section -->
              <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border); padding: 1rem; border-radius: 12px; margin-bottom: 1.5rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: flex-end;">
                <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 140px;">
                  <label style="font-size: 0.75rem;">From Date</label>
                  <input type="date" id="userOrderFromDate" onchange="renderUserOrders()" style="padding: 0.4rem; font-size: 0.85rem;">
                </div>
                <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 140px;">
                  <label style="font-size: 0.75rem;">To Date</label>
                  <input type="date" id="userOrderToDate" onchange="renderUserOrders()" style="padding: 0.4rem; font-size: 0.85rem;">
                </div>
                <div class="form-group" style="margin-bottom: 0; flex: 1.5; min-width: 180px;">
                  <label style="font-size: 0.75rem;">User Filter</label>
                  <select id="userOrderUserFilter" onchange="renderUserOrders()" style="padding: 0.4rem; font-size: 0.85rem;">
                    <option value="">All Users</option>
                  </select>
                </div>
                <div class="form-group" style="margin-bottom: 0; flex: 1.2; min-width: 150px;">
                  <label style="font-size: 0.75rem;">Status Filter</label>
                  <select id="userOrderStatusFilter" onchange="renderUserOrders()" style="padding: 0.4rem; font-size: 0.85rem;">
                    <option value="">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
                <button onclick="clearUserOrderFilters()" style="padding: 0.45rem 1rem; font-size: 0.85rem; background: rgba(255,255,255,0.08); border: 1px solid var(--glass-border); color: #fff; cursor: pointer; border-radius: 8px;">
                  Reset
                </button>
              </div>

              <div class="table-container">
                <table id="userOrdersTable">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>User</th>
                      <th>Deposit Amount</th>
                      <th>UTR Reference</th>
                      <th>Transferred From</th>
                      <th>Screenshot</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody id="userOrdersTableBody">
                    <tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Loading deposit history...</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- TAB: User Expiry Report -->
            <div id="userExpiryReportTab" class="tab-content ${state.currentTab === 'userExpiryReportTab' ? 'active' : ''}">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
                <div class="card-title" style="margin-bottom: 0;">User Subscription Expiry Report</div>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  <label style="font-size: 0.85rem; color: var(--text-muted);">Filter Status:</label>
                  <select id="userExpiryStatusFilter" onchange="renderUserExpiryReport()" style="padding: 0.4rem 0.85rem; font-size: 0.85rem; background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); color: #fff; border-radius: 8px;">
                    <option value="all">All Users</option>
                    <option value="active">Active Plans</option>
                    <option value="deactive">Deactivated / Expired</option>
                  </select>
                </div>
              </div>

              <div class="table-container">
                <table id="userExpiryReportTable">
                  <thead>
                    <tr>
                      <th>User ID</th>
                      <th>User Name</th>
                      <th>Email / Phone</th>
                      <th>Plan Expiration Date</th>
                      <th>Time Remaining</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody id="userExpiryReportTableBody">
                    <tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Loading expiry details...</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- TAB: Account Settings / Change Password -->
            <div id="changePasswordTab" class="tab-content ${state.currentTab === 'changePasswordTab' ? 'active' : ''}">
              <div class="card-title">Change Account Password</div>
              <div style="background: rgba(255,255,255,0.02); padding: 1.5rem; border-radius: 12px; border: 1px solid var(--glass-border); max-width: 450px;">
                <form id="changePasswordForm" onsubmit="handleChangePassword(event)" style="display: flex; flex-direction: column; gap: 1rem;">
                  <div id="changePwAlert" style="display: none; padding: 0.75rem; border-radius: 8px; font-size: 0.85rem; text-align: center;"></div>
                  <div class="form-group">
                    <label>Current Password</label>
                    <input type="password" id="currentPassword" required placeholder="Enter your current password">
                  </div>
                  <div class="form-group">
                    <label>New Password</label>
                    <input type="password" id="newPassword" required placeholder="Minimum 6 characters">
                  </div>
                  <div class="form-group">
                    <label>Confirm New Password</label>
                    <input type="password" id="confirmNewPassword" required placeholder="Re-enter new password">
                  </div>
                  <button type="submit">Update Password</button>
                </form>
              </div>
            </div>

            <!-- TAB: API Documentation -->
            <div id="apiDocsTab" class="tab-content ${state.currentTab === 'apiDocsTab' ? 'active' : ''}">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
                <div class="card-title" style="margin-bottom: 0;">Developer API Reference</div>
                <a href="/api_documentation.md" download="api_documentation.md" class="btn-secondary" style="text-decoration: none; display: inline-flex; align-items: center; gap: 0.5rem; background: var(--accent-color); color: #fff; padding: 0.5rem 1rem; border-radius: 8px; font-weight: 500; font-size: 0.9rem;">
                  📥 Download API Doc (.md)
                </a>
              </div>

              <!-- API Token Section for User -->
              <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 12px; padding: 1.25rem; margin-bottom: 1.5rem; backdrop-filter: blur(8px);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
                  <div style="font-size: 0.95rem; font-weight: 600; color: #a5b4fc; display: flex; align-items: center; gap: 0.5rem;">
                    <span>🔑</span> Your API Authorization Token
                  </div>
                  <button id="copyUserApiTokenBtn" onclick="copyUserApiToken()" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); border: none; color: #fff; padding: 0.4rem 0.85rem; border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 0.3rem; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);">
                    📋 Copy Token
                  </button>
                </div>
                <div style="background: rgba(0,0,0,0.4); border: 1px solid rgba(99,102,241,0.25); border-radius: 8px; padding: 0.75rem; word-break: break-all; font-family: Consolas, 'Courier New', monospace; font-size: 0.75rem; color: #cbd5e1; line-height: 1.5; max-height: 80px; overflow-y: auto;" id="userApiTokenValue">
                  ${state.token}
                </div>
                <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 0.5rem; line-height: 1.4;">
                  Include this in the headers as: <code style="color: #a5b4fc; font-family: Consolas, monospace; background: rgba(0,0,0,0.2); padding: 0.1rem 0.3rem; border-radius: 4px;">Authorization: Bearer &lt;token&gt;</code>. Expiring in 30 days from generation.
                </div>
              </div>
              
              <div class="docs-container" style="background: rgba(0,0,0,0.25); padding: 1.5rem; border-radius: 12px; border: 1px solid var(--glass-border); max-height: 550px; overflow-y: auto; color: #e2e8f0; border: 1px solid rgba(255,255,255,0.05);">
                <pre style="white-space: pre-wrap; font-size: 0.85rem; margin: 0; font-family: 'Consolas', 'Courier New', monospace; line-height: 1.6;" id="apiDocsContent">Loading documentation...</pre>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // ADMIN-ONLY DASHBOARD (WhatsApp Studio tabs removed)
    function renderAdminDashboard() {
      // If currentTab is still user tab, default to user manager
      if (state.currentTab === 'whatsappTab') {
        state.currentTab = 'adminUsersTab';
      }

      return `
        <header>
          <div class="brand">
            <h1>WhatsApp Messaging — Admin Portal</h1>
            <p>User Accounts Directory, Deposit approvals, and Bank Details settings</p>
          </div>
          <div class="user-profile">
            <div class="user-details">
              <div class="user-name">${state.user.name}</div>
              <div class="user-role" style="color: var(--warning-color);">SYSTEM ADMIN</div>
            </div>
            <button class="btn-logout" onclick="handleLogout()">Sign Out</button>
          </div>
        </header>

        <div class="admin-layout">
          <div class="card">
            <div class="tabs-nav">
              <button class="tab-btn ${state.currentTab === 'adminUsersTab' ? 'active' : ''}" onclick="switchTab('adminUsersTab')">Manage Users</button>
              <button class="tab-btn ${state.currentTab === 'adminOrdersTab' ? 'active' : ''}" onclick="switchTab('adminOrdersTab')">Confirm Deposits</button>
              <button class="tab-btn ${state.currentTab === 'adminExpiryReportTab' ? 'active' : ''}" onclick="switchTab('adminExpiryReportTab')">Expiry Report</button>
              <button class="tab-btn ${state.currentTab === 'adminBanksTab' ? 'active' : ''}" onclick="switchTab('adminBanksTab')">Manage Banks</button>
              <button class="tab-btn ${state.currentTab === 'adminSettingsTab' ? 'active' : ''}" onclick="switchTab('adminSettingsTab')">SaaS Settings</button>
            </div>

            <!-- TAB: Admin Users Directory -->
            <div id="adminUsersTab" class="tab-content ${state.currentTab === 'adminUsersTab' ? 'active' : ''}">
              <div style="display: grid; grid-template-columns: 1fr; gap: 1.5rem;">
                
                <!-- Summary Stats Block -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                  <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border); padding: 1rem; border-radius: 12px; backdrop-filter: blur(8px);">
                    <div style="font-size: 0.8rem; color: var(--text-muted);">Total User Wallet Balance</div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: #a5b4fc; margin-top: 0.25rem;" id="totalUserWalletBalance">₹0.00</div>
                  </div>
                  <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border); padding: 1rem; border-radius: 12px; backdrop-filter: blur(8px);">
                    <div style="font-size: 0.8rem; color: var(--text-muted);">Active Subscriptions</div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--accent-color); margin-top: 0.25rem;" id="totalActiveSubscriptions">0</div>
                  </div>
                  <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border); padding: 1rem; border-radius: 12px; backdrop-filter: blur(8px);">
                    <div style="font-size: 0.8rem; color: var(--text-muted);">Expiring Within 5 Days</div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--warning-color); margin-top: 0.25rem;" id="totalExpiringSoon">0</div>
                  </div>
                </div>

                <!-- Subgrid: Create User manually + Wallet Credits -->
                <div class="admin-forms-grid">
                  
                  <!-- Create User Form -->
                  <div style="background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 12px; border: 1px solid var(--glass-border); display: flex; flex-direction: column; gap: 0.75rem;">
                    <div style="font-weight: 600; font-size: 0.95rem;">Create New User Account</div>
                    <form id="adminCreateUserForm" onsubmit="handleAdminCreateUser(event)" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                      <div class="form-group">
                        <label>Full Name</label>
                        <input type="text" id="adminNewName" required placeholder="Name">
                      </div>
                      <div class="form-group">
                        <label>Email Address</label>
                        <input type="email" id="adminNewEmail" required placeholder="Email">
                      </div>
                      <div class="form-group">
                        <label>Phone Number</label>
                        <input type="text" id="adminNewPhone" placeholder="Phone with country code">
                      </div>
                      <div class="form-group">
                        <label>Password</label>
                        <input type="password" id="adminNewPassword" required placeholder="Min 6 chars">
                      </div>
                      <div class="form-group" style="grid-column: span 2;">
                        <label>Role</label>
                        <select id="adminNewRole">
                          <option value="user">User / Subscriber</option>
                          <option value="admin">Admin / System Manager</option>
                        </select>
                      </div>
                      <button type="submit" style="grid-column: span 2; margin-top: 0.25rem;">Create Account</button>
                    </form>
                  </div>

                  <!-- Direct Credit Form -->
                  <div style="background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 12px; border: 1px solid var(--glass-border); display: flex; flex-direction: column; gap: 0.75rem;">
                    <div style="font-weight: 600; font-size: 0.95rem;">Credit User Wallet</div>
                    <form id="adminCreditForm" onsubmit="handleAdminCredit(event)" style="display: flex; flex-direction: column; gap: 0.5rem; justify-content: flex-end; height: 100%;">
                      <div class="form-group">
                        <label>User ID</label>
                        <input type="number" id="creditUserId" required placeholder="Database User ID">
                      </div>
                      <div class="form-group">
                        <label>Amount (₹)</label>
                        <input type="number" id="creditAmount" required placeholder="Amount">
                      </div>
                      <div class="form-group">
                        <label>Reason / Note</label>
                        <input type="text" id="creditReason" placeholder="Recharge bonus">
                      </div>
                      <button type="submit" style="margin-top: 0.25rem;">Apply Credit</button>
                    </form>
                  </div>
                </div>

                <!-- Users Table -->
                <div class="table-container">
                  <table id="adminUsersTable">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Email / Phone</th>
                        <th>Role</th>
                        <th>Wallet</th>
                        <th>Plan Status</th>
                        <th>Expiry</th>
                        <th>Connection Access</th>
                        <th>API Token</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td colspan="9" style="text-align: center; color: var(--text-muted);">Loading users list...</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <!-- TAB: Deposit Approvals -->
            <div id="adminOrdersTab" class="tab-content ${state.currentTab === 'adminOrdersTab' ? 'active' : ''}">
              <div class="card-title">Deposit Request History & Approvals</div>
              
              <!-- Filters Section -->
              <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border); padding: 1rem; border-radius: 12px; margin-bottom: 1.5rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: flex-end;">
                <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 140px;">
                  <label style="font-size: 0.75rem;">From Date</label>
                  <input type="date" id="adminOrderFromDate" onchange="filterAdminOrders()" style="padding: 0.4rem; font-size: 0.85rem;">
                </div>
                <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 140px;">
                  <label style="font-size: 0.75rem;">To Date</label>
                  <input type="date" id="adminOrderToDate" onchange="filterAdminOrders()" style="padding: 0.4rem; font-size: 0.85rem;">
                </div>
                <div class="form-group" style="margin-bottom: 0; flex: 1.5; min-width: 180px;">
                  <label style="font-size: 0.75rem;">User Filter</label>
                  <select id="adminOrderUserFilter" onchange="filterAdminOrders()" style="padding: 0.4rem; font-size: 0.85rem;">
                    <option value="">All Users</option>
                  </select>
                </div>
                <div class="form-group" style="margin-bottom: 0; flex: 1.2; min-width: 150px;">
                  <label style="font-size: 0.75rem;">Status Filter</label>
                  <select id="adminOrderStatusFilter" onchange="filterAdminOrders()" style="padding: 0.4rem; font-size: 0.85rem;">
                    <option value="">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
                <button onclick="clearAdminOrderFilters()" style="padding: 0.45rem 1rem; font-size: 0.85rem; background: rgba(255,255,255,0.08); border: 1px solid var(--glass-border); color: #fff; cursor: pointer; border-radius: 8px;">
                  Reset
                </button>
              </div>

              <div class="table-container">
                <table id="adminPendingOrdersTable">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>User</th>
                      <th>Deposit Amount</th>
                      <th>UTR Reference</th>
                      <th>Transferred From</th>
                      <th>Screenshot</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td colspan="8" style="text-align: center; color: var(--text-muted);">Loading deposit requests...</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- TAB: Manage Banks (Add, Show, Edit) -->
            <div id="adminBanksTab" class="tab-content ${state.currentTab === 'adminBanksTab' ? 'active' : ''}">
              <div style="display: grid; grid-template-columns: 1fr; gap: 1.5rem;">
                <div class="admin-banks-grid">
                  
                  <!-- Create / Edit Bank Account -->
                  <div style="background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 12px; border: 1px solid var(--glass-border);">
                    <div style="font-weight: 600; margin-bottom: 0.75rem;" id="bankFormTitle">Add New Bank Account</div>
                    <form id="adminBankForm" onsubmit="handleBankSubmit(event)" style="display: flex; flex-direction: column; gap: 0.75rem;">
                      <div class="form-group">
                        <label>Bank Name</label>
                        <input type="text" id="bankNameInput" required placeholder="e.g. State Bank of India">
                      </div>
                      <div class="form-group">
                        <label>Account Number</label>
                        <input type="text" id="bankAccountInput" required placeholder="Account Number">
                      </div>
                      <div class="form-group">
                        <label>IFSC Code</label>
                        <input type="text" id="bankIfscInput" required placeholder="e.g. SBIN0001234">
                      </div>
                      <div class="form-group">
                        <label>Account Holder Name</label>
                        <input type="text" id="bankHolderInput" required placeholder="Account Holder Name">
                      </div>
                      <div class="form-group">
                        <label>Account Status</label>
                        <select id="bankStatusInput">
                          <option value="1">Active (Visible to users)</option>
                          <option value="0">Inactive (Hidden)</option>
                        </select>
                      </div>
                      <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
                        <button type="submit" id="bankSubmitBtn" style="flex:1;">Create Bank Account</button>
                        <button type="button" id="bankCancelBtn" onclick="resetBankForm()" class="btn-secondary" style="display:none; flex:1;">Cancel Edit</button>
                      </div>
                    </form>
                  </div>

                  <!-- Active Banks Overview -->
                  <div>
                    <div style="font-weight: 600; margin-bottom: 0.75rem;">Configured Bank Details</div>
                    <div class="table-container">
                      <table id="adminBanksTable">
                        <thead>
                          <tr>
                            <th>Bank Name</th>
                            <th>Details</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Loading banks...</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- TAB: SaaS Settings (Price Config) -->
            <div id="adminSettingsTab" class="tab-content ${state.currentTab === 'adminSettingsTab' ? 'active' : ''}">
              <div class="card-title">SaaS Pricing Config</div>
              <div style="background: rgba(255,255,255,0.02); padding: 1.5rem; border-radius: 12px; border: 1px solid var(--glass-border); max-width: 500px;">
                <form id="adminPriceForm" onsubmit="handlePriceSubmit(event)" style="display: flex; flex-direction: column; gap: 1rem;">
                  <div class="form-group">
                    <label>Monthly Plan Price (₹ / 28 Days)</label>
                    <input type="number" id="settingPlanPrice28" required min="1" placeholder="e.g. 199">
                  </div>
                  <div class="form-group">
                    <label>Quarter Plan Price (₹ / 90 Days)</label>
                    <input type="number" id="settingPlanPriceQuarter" required min="1" placeholder="e.g. 549">
                  </div>
                  <div class="form-group">
                    <label>Half-Year Plan Price (₹ / 180 Days)</label>
                    <input type="number" id="settingPlanPriceHalfYear" required min="1" placeholder="e.g. 999">
                  </div>
                  <div class="form-group">
                    <label>Year Plan Price (₹ / 365 Days)</label>
                    <input type="number" id="settingPlanPriceYear" required min="1" placeholder="e.g. 1899">
                  </div>
                  <button type="submit">Update Plan Prices</button>
                </form>
              </div>
            </div>

            <!-- TAB: Expiry Report -->
            <div id="adminExpiryReportTab" class="tab-content ${state.currentTab === 'adminExpiryReportTab' ? 'active' : ''}">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
                <div class="card-title" style="margin-bottom: 0;">User Subscription Expiry Report</div>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  <label style="font-size: 0.85rem; color: var(--text-muted);">Filter Status:</label>
                  <select id="adminExpiryStatusFilter" onchange="renderExpiryReport()" style="padding: 0.4rem 0.85rem; font-size: 0.85rem; background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); color: #fff; border-radius: 8px;">
                    <option value="all">All Users</option>
                    <option value="active">Active Plans</option>
                    <option value="deactive">Deactivated / Expired</option>
                  </select>
                </div>
              </div>
              
              <div class="table-container">
                <table id="adminExpiryReportTable">
                  <thead>
                    <tr>
                      <th>User ID</th>
                      <th>User Name</th>
                      <th>Email / Phone</th>
                      <th>Plan Expiration Date</th>
                      <th>Time Remaining</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Loading expiry details...</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // AUTH ACTIONS
    function switchAuthTab(tab) {
      state.publicPage = 'auth';
      state.authTab = tab;
      renderApp();
    }

    function bindAuthEvents() {
      const loginTabBtn = document.getElementById('loginTabBtn');
      const registerTabBtn = document.getElementById('registerTabBtn');
      const forgotTabBtn = document.getElementById('forgotTabBtn');

      if (loginTabBtn) loginTabBtn.onclick = () => switchAuthTab('login');
      if (registerTabBtn) registerTabBtn.onclick = () => switchAuthTab('register');
      if (forgotTabBtn) forgotTabBtn.onclick = () => { state.forgotResetStep = 'email'; switchAuthTab('forgot'); };
      if (state.authTab === 'register') loadCaptcha();
    }

    async function loadCaptcha() {
      try {
        const res = await fetch('/auth/captcha');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load captcha');
        state.captchaId = data.id;
        state.captchaQuestion = data.question;
        state.captchaImage = data.image || '';
        const visualBox = document.getElementById('captchaVisualBox');
        const questionEl = document.getElementById('captchaQuestion');
        const imageEl = document.getElementById('captchaImage');
        const answerEl = document.getElementById('regCaptchaAnswer');
        if (visualBox && data.image) {
          visualBox.innerHTML = `<img id="captchaImage" src="${data.image}" alt="Signup security code" style="width: 100%; max-width: 260px; height: 92px; object-fit: contain; display: block;">`;
        }
        if (questionEl) questionEl.textContent = data.question;
        if (imageEl && data.image) imageEl.src = data.image;
        if (answerEl) answerEl.value = '';
      } catch (err) {
        state.captchaId = null;
        state.captchaQuestion = 'Captcha unavailable';
        state.captchaImage = '';
        const visualBox = document.getElementById('captchaVisualBox');
        const questionEl = document.getElementById('captchaQuestion');
        if (visualBox) {
          visualBox.innerHTML = `<div id="captchaQuestion" style="color: var(--accent-color); font-weight: 700;">${state.captchaQuestion}</div>`;
        }
        if (questionEl) questionEl.textContent = state.captchaQuestion;
      }
    }

    async function handleLogin(e) {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;

      showAuthAlert('');
      try {
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Authentication failed');

        state.token = data.token;
        localStorage.setItem('token', data.token);
        
        state.user = null;
        state.plan = null;
        state.plans = [];
        state.orders = [];
        state.transactions = [];
        state.currentTab = 'whatsappTab';
        
        renderApp();
      } catch (err) {
        showAuthAlert(err.message);
      }
    }

    async function handleRegister(e) {
      e.preventDefault();
      const name = document.getElementById('regName').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const phone = document.getElementById('regPhone').value.trim();
      const password = document.getElementById('regPassword').value;
      const captchaAnswer = document.getElementById('regCaptchaAnswer').value.trim();

      showAuthAlert('');
      try {
        const res = await fetch('/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, phone, password, captchaId: state.captchaId, captchaAnswer })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');

        state.token = data.token;
        localStorage.setItem('token', data.token);

        state.user = null;
        state.plan = null;
        state.plans = [];
        state.orders = [];
        state.transactions = [];
        state.currentTab = 'whatsappTab';

        renderApp();
      } catch (err) {
        showAuthAlert(err.message);
        loadCaptcha();
      }
    }

    function showAuthAlert(msg) {
      const alertDiv = document.getElementById('authAlert');
      if (!alertDiv) return;
      if (msg) {
        alertDiv.textContent = msg;
        alertDiv.style.display = 'block';
      } else {
        alertDiv.style.display = 'none';
      }
    }

    function showAuthSuccess(msg) {
      const el = document.getElementById('authSuccess');
      if (!el) return;
      if (msg) {
        el.textContent = msg;
        el.style.display = 'block';
      } else {
        el.style.display = 'none';
      }
    }

    async function handleForgotPassword(e) {
      e.preventDefault();
      const email = document.getElementById('forgotEmail').value.trim();
      showAuthAlert('');
      showAuthSuccess('');

      try {
        const res = await fetch('/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to process request');

        state.forgotEmail = email;

        if (data.showOtp && data.otp) {
          // Display OTP directly (dev mode - no email service)
          state.forgotOtp = data.otp;
          state.forgotResetStep = 'otp';
          renderApp();
          // Pre-fill the OTP field
          setTimeout(() => {
            const otpInput = document.getElementById('resetOtp');
            if (otpInput) otpInput.value = data.otp;
            showAuthSuccess(`Your reset code is: ${data.otp} (valid for 15 min)`);
          }, 100);
        } else {
          showAuthSuccess(data.message);
        }
      } catch (err) {
        showAuthAlert(err.message);
      }
    }

    async function handleResetPassword(e) {
      e.preventDefault();
      const otp = document.getElementById('resetOtp').value.trim();
      const newPassword = document.getElementById('resetNewPassword').value;
      const confirmPassword = document.getElementById('resetConfirmPassword').value;

      showAuthAlert('');
      showAuthSuccess('');

      if (newPassword !== confirmPassword) {
        showAuthAlert('Passwords do not match');
        return;
      }

      try {
        const res = await fetch('/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: state.forgotEmail, otp, newPassword })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Reset failed');

        state.forgotResetStep = 'done';
        renderApp();
      } catch (err) {
        showAuthAlert(err.message);
      }
    }

    async function handleChangePassword(e) {
      e.preventDefault();
      const currentPassword = document.getElementById('currentPassword').value;
      const newPassword = document.getElementById('newPassword').value;
      const confirmNewPassword = document.getElementById('confirmNewPassword').value;
      const alertDiv = document.getElementById('changePwAlert');

      // Reset alert
      if (alertDiv) alertDiv.style.display = 'none';

      if (newPassword !== confirmNewPassword) {
        if (alertDiv) {
          alertDiv.textContent = 'New passwords do not match';
          alertDiv.style.display = 'block';
          alertDiv.style.background = 'rgba(244, 63, 94, 0.15)';
          alertDiv.style.border = '1px solid var(--error-color)';
          alertDiv.style.color = 'var(--error-color)';
        }
        return;
      }

      if (newPassword.length < 6) {
        if (alertDiv) {
          alertDiv.textContent = 'New password must be at least 6 characters';
          alertDiv.style.display = 'block';
          alertDiv.style.background = 'rgba(244, 63, 94, 0.15)';
          alertDiv.style.border = '1px solid var(--error-color)';
          alertDiv.style.color = 'var(--error-color)';
        }
        return;
      }

      try {
        const res = await fetch('/auth/change-password', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${state.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to change password');

        if (alertDiv) {
          alertDiv.textContent = data.message || 'Password updated successfully!';
          alertDiv.style.display = 'block';
          alertDiv.style.background = 'rgba(16, 185, 129, 0.15)';
          alertDiv.style.border = '1px solid var(--accent-color)';
          alertDiv.style.color = 'var(--accent-color)';
        }
        // Clear form
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmNewPassword').value = '';
      } catch (err) {
        if (alertDiv) {
          alertDiv.textContent = err.message;
          alertDiv.style.display = 'block';
          alertDiv.style.background = 'rgba(244, 63, 94, 0.15)';
          alertDiv.style.border = '1px solid var(--error-color)';
          alertDiv.style.color = 'var(--error-color)';
        }
      }
    }

    // GENERAL DASHBOARD CONTROLS
    function switchTab(tabId) {
      state.currentTab = tabId;
      renderApp();
    }

    function switchSubTab(subTabId) {
      state.whatsappSubTab = subTabId;
      renderApp();
    }

    function handleLogout() {
      stopPollingWhatsappStatus();
      localStorage.removeItem('token');
      state.token = null;
      state.user = null;
      state.plan = null;
      state.plans = [];
      state.orders = [];
      state.transactions = [];
      state.currentTab = 'whatsappTab';
      state.whatsappSubTab = 'textTab';
      state.publicPage = 'home';
      state.authTab = 'login';
      renderApp();
    }

    async function fetchUserProfile() {
      if (!state.token) return;
      try {
        const res = await fetch('/auth/me', {
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        if (res.status === 401 || res.status === 403) {
          alert('Session expired or account blocked.');
          handleLogout();
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        state.user = data.user;
        state.plan = data.plan;
        state.plans = data.plans || [];
        state.orders = data.orders || [];
        state.transactions = data.transactions || [];
        
        // Dynamic settings
        state.banks = data.banks || [];
        state.planPrice = data.planPrice || 149;
        state.planOptions = data.planOptions || [];

        renderApp();

        // Start polling if subscriber and plan is active (Admins bypass polling as they don't have studio)
        const hasActivePlan = state.plan && state.plan.status === 'active' && new Date(state.plan.expires_at) > new Date();
        if (hasActivePlan && state.user.role !== 'admin') {
          startPollingWhatsappStatus();
        }
        bindDashboardEvents();
      } catch (err) {
        console.error('Error fetching profile:', err);
      }
    }

    // USER ORDER SUBMIT
    async function handleOrderSubmit(e) {
      e.preventDefault();
      const bankId = document.getElementById('orderBankSelect').value;
      const account_name = document.getElementById('orderAccountName').value.trim();
      const utr = document.getElementById('orderUtr').value.trim();
      const fileInput = document.getElementById('orderScreenshot');
      const plan_type = document.getElementById('orderPlanTypeSelect').value;
      const amount = document.getElementById('orderAmountInput').value.trim();

      if (!bankId) {
        alert('Please choose the destination bank account where you transferred funds.');
        return;
      }

      // Find selected bank details
      const selectedBank = state.banks.find(b => b.id == bankId);
      if (!selectedBank) return;

      const formData = new FormData();
      formData.append('bank_name', selectedBank.bank_name);
      formData.append('account_name', account_name);
      formData.append('utr', utr);
      formData.append('plan_type', plan_type);
      formData.append('amount', amount);
      if (fileInput.files.length > 0) {
        formData.append('screenshot', fileInput.files[0]);
      }

      try {
        const res = await fetch('/auth/orders', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${state.token}` },
          body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Submission failed');

        alert(data.message);
        fetchUserProfile(); // reload dashboard
      } catch (err) {
        alert(`Failed to submit deposit: ${err.message}`);
      }
    }

    function handleOrderPlanSelectChange(select) {
      const amountInput = document.getElementById('orderAmountInput');
      if (!amountInput) return;
      if (select.value === 'wallet') {
        amountInput.readOnly = false;
        amountInput.value = '';
        amountInput.placeholder = 'Enter amount to recharge';
        amountInput.focus();
      } else {
        const plan = state.planOptions.find(p => p.type === select.value);
        if (plan) {
          amountInput.value = plan.price;
          amountInput.readOnly = true;
        }
      }
    }

    async function purchasePlan(planType, price, durationDays) {
      if (planType === 'demo') {
        if (!confirm('Are you sure you want to claim your 10-day Free Demo Plan? This can only be claimed once.')) return;
      } else {
        const planName = planType === 'plan_28' ? 'Monthly' : planType === 'quarter' ? 'Quarter' : planType === 'half_year' ? 'Half-Year' : 'Year';
        if (!confirm(`Are you sure you want to subscribe to the ${planName} Plan for ₹${price}?`)) return;
      }

      try {
        const res = await fetch('/auth/subscribe', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${state.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ planType })
        });
        const data = await res.json();
        
        if (!res.ok) {
          // If insufficient balance, redirect to deposit form
          if (data.error && data.error.includes('Insufficient wallet balance')) {
            alert(data.error);
            const planSelect = document.getElementById('orderPlanTypeSelect');
            const amountInput = document.getElementById('orderAmountInput');
            
            if (planSelect) {
              planSelect.value = planType;
              if (amountInput) {
                amountInput.value = price;
                amountInput.readOnly = true;
              }
            }
            const orderForm = document.getElementById('orderForm');
            if (orderForm) {
              orderForm.scrollIntoView({ behavior: 'smooth' });
              orderForm.parentElement.style.border = '1px solid var(--accent-color)';
              setTimeout(() => {
                orderForm.parentElement.style.border = '1px solid var(--glass-border)';
              }, 2500);
            }
            return;
          }
          throw new Error(data.error || 'Failed to purchase subscription');
        }

        alert(data.message || 'Subscription activated successfully!');
        fetchUserProfile();
      } catch (err) {
        alert(err.message);
      }
    }

    // BIND EVENT DISPATCHERS & FETCH DATA ON TAB ACTIVE
    function bindDashboardEvents() {
      if (state.currentTab === 'adminOrdersTab') {
        fetchAdminOrders();
      } else if (state.currentTab === 'adminUsersTab') {
        fetchAdminUsers();
      } else if (state.currentTab === 'adminExpiryReportTab') {
        fetchAdminUsers().then(() => renderExpiryReport());
      } else if (state.currentTab === 'adminBanksTab') {
        fetchAdminBanks();
      } else if (state.currentTab === 'adminSettingsTab') {
        fetchAdminSettings();
      } else if (state.currentTab === 'ordersTab') {
        renderUserOrders();
      } else if (state.currentTab === 'userExpiryReportTab') {
        renderUserExpiryReport();
      } else if (state.currentTab === 'apiDocsTab') {
        loadApiDocs();
      }
    }

    async function loadApiDocs() {
      try {
        const res = await fetch('/api_documentation.md');
        if (res.ok) {
          const text = await res.text();
          const pre = document.getElementById('apiDocsContent');
          if (pre) pre.textContent = text;
        } else {
          const pre = document.getElementById('apiDocsContent');
          if (pre) pre.textContent = 'Error: Failed to load API documentation file.';
        }
      } catch (err) {
        console.error('Failed to load API docs:', err);
        const pre = document.getElementById('apiDocsContent');
           // ADMIN TAB: settings (plan price)
    async function fetchAdminSettings() {
      try {
        const res = await fetch('/admin/settings', {
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();
        
        const p28Input = document.getElementById('settingPlanPrice28');
        const pQuarterInput = document.getElementById('settingPlanPriceQuarter');
        const pHalfYearInput = document.getElementById('settingPlanPriceHalfYear');
        const pYearInput = document.getElementById('settingPlanPriceYear');

        if (p28Input && data.plan_price_28) p28Input.value = data.plan_price_28;
        if (pQuarterInput && data.plan_price_quarter) pQuarterInput.value = data.plan_price_quarter;
        if (pHalfYearInput && data.plan_price_half_year) pHalfYearInput.value = data.plan_price_half_year;
        if (pYearInput && data.plan_price_year) pYearInput.value = data.plan_price_year;
      } catch (e) {
        console.error(e);
      }
    }

    async function handlePriceSubmit(e) {
      e.preventDefault();
      const p28 = document.getElementById('settingPlanPrice28').value.trim();
      const pQuarter = document.getElementById('settingPlanPriceQuarter').value.trim();
      const pHalfYear = document.getElementById('settingPlanPriceHalfYear').value.trim();
      const pYear = document.getElementById('settingPlanPriceYear').value.trim();

      try {
        const updateSetting = async (key, value) => {
          const res = await fetch('/admin/settings', {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${state.token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ key, value })
          });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || `Failed to update ${key}`);
          }
        };

        await updateSetting('plan_price_28', p28);
        await updateSetting('plan_price', p28); // legacy fallback
        await updateSetting('plan_price_quarter', pQuarter);
        await updateSetting('plan_price_half_year', pHalfYear);
        await updateSetting('plan_price_year', pYear);

        alert('Pricing settings updated successfully!');
        fetchUserProfile();
      } catch (err) {
        alert(`Failed to update setting: ${err.message}`);
      }
    }

    // ADMIN TAB: orders history list & filtering
    let allAdminOrders = [];

    function getLocalDateString() {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }

    function normalizeDateString(value) {
      if (!value) return value;
      if (value.includes(' ') && !value.includes('T')) {
        return value.replace(' ', 'T') + 'Z';
      }
      if (!value.includes('Z') && !value.includes('+')) {
        return value + 'Z';
      }
      return value;
    }

    async function fetchAdminOrders() {
      const tableBody = document.querySelector('#adminPendingOrdersTable tbody');
      if (!tableBody) return;

      // Initialize date inputs to current date by default if they are empty
      const fromDateInput = document.getElementById('adminOrderFromDate');
      const toDateInput = document.getElementById('adminOrderToDate');
      const todayStr = getLocalDateString();
      if (fromDateInput && !fromDateInput.value) {
        fromDateInput.value = todayStr;
      }
      if (toDateInput && !toDateInput.value) {
        toDateInput.value = todayStr;
      }

      try {
        const res = await fetch('/admin/orders', {
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();
        allAdminOrders = data.orders || [];

        // Populate User Filter dropdown once
        populateAdminOrderUserFilter(allAdminOrders);

        // Run filtering & rendering
        filterAdminOrders();
      } catch (err) {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--error-color);">Error: ${err.message}</td></tr>`;
      }
    }

    function populateAdminOrderUserFilter(orders) {
      const select = document.getElementById('adminOrderUserFilter');
      if (!select) return;
      
      const currentVal = select.value;
      const usersMap = {};
      orders.forEach(o => {
        if (o.user_id) {
          usersMap[o.user_id] = o.user_name || `User #${o.user_id}`;
        }
      });

      let optionsHtml = '<option value="">All Users</option>';
      Object.keys(usersMap).forEach(userId => {
        optionsHtml += `<option value="${userId}">${usersMap[userId]} (ID: ${userId})</option>`;
      });

      select.innerHTML = optionsHtml;
      select.value = currentVal;
    }

    function filterAdminOrders() {
      const tableBody = document.querySelector('#adminPendingOrdersTable tbody');
      if (!tableBody) return;

      const fromDateVal = document.getElementById('adminOrderFromDate')?.value || '';
      const toDateVal = document.getElementById('adminOrderToDate')?.value || '';
      const userFilterVal = document.getElementById('adminOrderUserFilter')?.value || '';
      const statusFilterVal = document.getElementById('adminOrderStatusFilter')?.value || '';

      const filtered = allAdminOrders.filter(o => {
        if (userFilterVal && String(o.user_id) !== String(userFilterVal)) {
          return false;
        }
        if (statusFilterVal && o.status !== statusFilterVal) {
          return false;
        }
        if (o.created_at) {
          // Parse o.created_at as UTC (normalizing space to T and appending Z if needed)
          let dateStr = o.created_at;
          if (dateStr.includes(' ') && !dateStr.includes('T')) {
            dateStr = dateStr.replace(' ', 'T') + 'Z';
          } else if (!dateStr.includes('Z') && !dateStr.includes('+')) {
            dateStr = dateStr + 'Z';
          }
          
          const orderLocalDate = new Date(dateStr);
          const yyyy = orderLocalDate.getFullYear();
          const mm = String(orderLocalDate.getMonth() + 1).padStart(2, '0');
          const dd = String(orderLocalDate.getDate()).padStart(2, '0');
          const orderDateOnly = `${yyyy}-${mm}-${dd}`;

          if (fromDateVal && orderDateOnly < fromDateVal) return false;
          if (toDateVal && orderDateOnly > toDateVal) return false;
        }
        return true;
      });

      // Sort: pending first, then by date descending
      filtered.sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return new Date(b.created_at) - new Date(a.created_at);
      });

      if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No matching deposit requests found.</td></tr>`;
        return;
      }

      tableBody.innerHTML = filtered.map(o => {
        let dateStr = o.created_at;
        if (dateStr.includes(' ') && !dateStr.includes('T')) {
          dateStr = dateStr.replace(' ', 'T') + 'Z';
        } else if (!dateStr.includes('Z') && !dateStr.includes('+')) {
          dateStr = dateStr + 'Z';
        }
        const orderDateFormatted = new Date(dateStr).toLocaleString();
        
        return `
          <tr>
            <td>${orderDateFormatted}</td>
            <td>
              <strong>${o.user_name}</strong><br>
              <span style="color: var(--text-muted); font-size: 0.75rem;">${o.user_email}</span>
            </td>
            <td>₹${o.amount.toFixed(2)}</td>
            <td><code>${o.utr}</code></td>
            <td>${o.bank_name} - ${o.account_name}</td>
            <td>
              ${o.screenshot_path ? `
                <a href="/uploads/${o.screenshot_path}" target="_blank" style="color: var(--info-color); text-decoration: underline; font-weight: 500;">
                  View Attachment
                </a>
              ` : '<span style="color: var(--text-muted);">None</span>'}
            </td>
            <td>
              <span class="badge ${
                o.status === 'pending' 
                  ? 'badge-pending' 
                  : o.status === 'confirmed' 
                  ? 'badge-active' 
                  : 'badge-expired'
              }">${o.status}</span>
            </td>
            <td>
              ${o.status === 'pending' ? `
                <div style="display: flex; gap: 0.25rem;">
                  <button onclick="adminConfirmOrder(${o.id})" style="padding: 0.35rem 0.6rem; font-size: 0.75rem; background: var(--accent-color);">Confirm</button>
                  <button onclick="adminRejectOrder(${o.id})" class="btn-danger" style="padding: 0.35rem 0.6rem; font-size: 0.75rem;">Reject</button>
                </div>
              ` : `<span style="color: var(--text-muted); font-size: 0.85rem;">Processed</span>`}
            </td>
          </tr>
        `;
      }).join('');
    }

    function clearAdminOrderFilters() {
      const fromDate = document.getElementById('adminOrderFromDate');
      const toDate = document.getElementById('adminOrderToDate');
      const userFilter = document.getElementById('adminOrderUserFilter');
      const statusFilter = document.getElementById('adminOrderStatusFilter');

      const todayStr = getLocalDateString();
      if (fromDate) fromDate.value = todayStr;
      if (toDate) toDate.value = todayStr;
      if (userFilter) userFilter.value = '';
      if (statusFilter) statusFilter.value = '';

      filterAdminOrders();
    }

    // USER TAB: orders history list & filtering
    function populateUserOrderUserFilter(orders) {
      const select = document.getElementById('userOrderUserFilter');
      if (!select) return;
      
      const currentVal = select.value;
      const usersMap = {};
      orders.forEach(o => {
        if (o.user_id) {
          usersMap[o.user_id] = o.user_name || state.user?.name || `User #${o.user_id}`;
        }
      });

      let optionsHtml = '<option value="">All Users</option>';
      Object.keys(usersMap).forEach(userId => {
        optionsHtml += `<option value="${userId}">${usersMap[userId]} (ID: ${userId})</option>`;
      });

      select.innerHTML = optionsHtml;
      
      // Restore previous selection if it is still valid
      if (currentVal && usersMap[currentVal]) {
        select.value = currentVal;
      } else {
        select.value = "";
      }
    }

    function renderUserOrderRow(o) {
      const orderDateFormatted = o.created_at ? new Date(normalizeDateString(o.created_at)).toLocaleString() : '-';
      const amount = Number(o.amount || 0);
      return `
        <tr>
          <td>${orderDateFormatted}</td>
          <td>
            <strong>${o.user_name || state.user?.name || 'Current User'}</strong><br>
            <span style="color: var(--text-muted); font-size: 0.75rem;">${o.user_email || state.user?.email || ''}</span>
          </td>
          <td>â‚¹${amount.toFixed(2)}</td>
          <td><code>${o.utr}</code></td>
          <td>${o.bank_name} - ${o.account_name}</td>
          <td>
            ${o.screenshot_path ? `
              <a href="/uploads/${o.screenshot_path}" target="_blank" style="color: var(--info-color); text-decoration: underline; font-weight: 500;">
                View Attachment
              </a>
            ` : '<span style="color: var(--text-muted);">None</span>'}
          </td>
          <td>
            <span class="badge ${
              o.status === 'pending' 
                ? 'badge-pending' 
                : o.status === 'confirmed' 
                ? 'badge-active' 
                : 'badge-expired'
            }">${o.status === 'pending' ? 'Pending Review' : o.status}</span>
            ${o.notes ? `<div style="font-size: 0.75rem; color: var(--error-color); margin-top: 0.2rem;">Reason: ${o.notes}</div>` : ''}
          </td>
        </tr>
      `;
    }

    function renderUserOrders() {
      const tableBody = document.getElementById('userOrdersTableBody');
      if (!tableBody) return;

      // Populate User Filter dropdown
      populateUserOrderUserFilter(state.orders || []);

      // Initialize date inputs to current date by default if they are empty
      const fromDateInput = document.getElementById('userOrderFromDate');
      const toDateInput = document.getElementById('userOrderToDate');
      const todayStr = getLocalDateString();
      if (fromDateInput && !fromDateInput.value) {
        fromDateInput.value = todayStr;
      }
      if (toDateInput && !toDateInput.value) {
        toDateInput.value = todayStr;
      }

      const fromDateVal = fromDateInput?.value || '';
      const toDateVal = toDateInput?.value || '';
      const userFilterVal = document.getElementById('userOrderUserFilter')?.value || '';
      const statusFilterVal = document.getElementById('userOrderStatusFilter')?.value || '';

      const filtered = (state.orders || []).filter(o => {
        if (userFilterVal && String(o.user_id) !== String(userFilterVal)) {
          return false;
        }
        if (statusFilterVal && o.status !== statusFilterVal) {
          return false;
        }
        if (o.created_at) {
          // Parse o.created_at as UTC (normalizing space to T and appending Z if needed)
          let dateStr = o.created_at;
          if (dateStr.includes(' ') && !dateStr.includes('T')) {
            dateStr = dateStr.replace(' ', 'T') + 'Z';
          } else if (!dateStr.includes('Z') && !dateStr.includes('+')) {
            dateStr = dateStr + 'Z';
          }
          
          const orderLocalDate = new Date(dateStr);
          const yyyy = orderLocalDate.getFullYear();
          const mm = String(orderLocalDate.getMonth() + 1).padStart(2, '0');
          const dd = String(orderLocalDate.getDate()).padStart(2, '0');
          const orderDateOnly = `${yyyy}-${mm}-${dd}`;

          if (fromDateVal && orderDateOnly < fromDateVal) return false;
          if (toDateVal && orderDateOnly > toDateVal) return false;
        }
        return true;
      });

      // Sort: pending first, then by date descending
      filtered.sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return new Date(b.created_at) - new Date(a.created_at);
      });

      if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No matching deposit requests found.</td></tr>`;
        return;
      }

      tableBody.innerHTML = filtered.map(renderUserOrderRow).join('');
      return;

      tableBody.innerHTML = filtered.map(o => {
        let dateStr = o.created_at;
        if (dateStr.includes(' ') && !dateStr.includes('T')) {
          dateStr = dateStr.replace(' ', 'T') + 'Z';
        } else if (!dateStr.includes('Z') && !dateStr.includes('+')) {
          dateStr = dateStr + 'Z';
        }
        const orderDateFormatted = new Date(dateStr).toLocaleString();
        
        return `
          <tr>
            <td>${orderDateFormatted}</td>
            <td>₹${o.amount.toFixed(2)}</td>
            <td><code>${o.utr}</code></td>
            <td>${o.bank_name} - ${o.account_name}</td>
            <td>
              <span class="badge ${
                o.status === 'pending' 
                  ? 'badge-pending' 
                  : o.status === 'confirmed' 
                  ? 'badge-active' 
                  : 'badge-expired'
              }">${o.status === 'pending' ? 'Pending Review' : o.status}</span>
              ${o.notes ? `<div style="font-size: 0.75rem; color: var(--error-color); margin-top: 0.2rem;">Reason: ${o.notes}</div>` : ''}
            </td>
          </tr>
        `;
      }).join('');
    }

    function clearUserOrderFilters() {
      const fromDate = document.getElementById('userOrderFromDate');
      const toDate = document.getElementById('userOrderToDate');
      const userFilter = document.getElementById('userOrderUserFilter');
      const statusFilter = document.getElementById('userOrderStatusFilter');

      const todayStr = getLocalDateString();
      if (fromDate) fromDate.value = todayStr;
      if (toDate) toDate.value = todayStr;
      if (userFilter) userFilter.value = '';
      if (statusFilter) statusFilter.value = '';

      renderUserOrders();
    }

    // USER TAB: Expiry Report list & filtering
    function renderUserExpiryReport() {
      const tableBody = document.getElementById('userExpiryReportTableBody');
      if (!tableBody) return;

      const filterVal = document.getElementById('userExpiryStatusFilter')?.value || 'all';
      const now = Date.now();

      if (!state.user) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Loading user details...</td></tr>`;
        return;
      }

      const plans = [...(state.plans || [])].sort((a, b) => {
        const aTime = a.expires_at ? new Date(normalizeDateString(a.expires_at)).getTime() : 0;
        const bTime = b.expires_at ? new Date(normalizeDateString(b.expires_at)).getTime() : 0;
        return bTime - aTime;
      });

      const latestPlan = state.plan || plans[0] || null;
      const expiresAt = latestPlan?.expires_at || null;
      const isActive = latestPlan?.status === 'active' && expiresAt && new Date(normalizeDateString(expiresAt)).getTime() > now;

      if (filterVal === 'active' && !isActive) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No active subscription found.</td></tr>`;
        return;
      }
      if (filterVal === 'deactive' && isActive) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No deactivated or expired subscription found.</td></tr>`;
        return;
      }

      let expiresDateFormatted = 'Never';
      let timeRemainingStr = '<span style="color: var(--text-muted);">No active plan history</span>';

      if (expiresAt) {
        const expiryDate = new Date(normalizeDateString(expiresAt));
        expiresDateFormatted = expiryDate.toLocaleString();
        const diffMs = expiryDate.getTime() - now;
        const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
        if (diffDays > 0) {
          timeRemainingStr = `<span style="color: var(--accent-color); font-weight: 600;">${diffDays} days left</span>`;
        } else {
          timeRemainingStr = `<span style="color: var(--error-color);">Expired ${Math.abs(diffDays)} days ago</span>`;
        }
      }

      tableBody.innerHTML = `
        <tr>
          <td><code>${state.user.id}</code></td>
          <td><strong>${state.user.name}</strong></td>
          <td>
            ${state.user.email}<br>
            <span style="color: var(--text-muted); font-size: 0.75rem;">${state.user.phone || 'No phone'}</span>
          </td>
          <td>${expiresDateFormatted}</td>
          <td>${timeRemainingStr}</td>
          <td>
            ${isActive 
              ? `<span class="badge badge-active">Active</span>` 
              : `<span class="badge badge-expired">Deactive</span>`
            }
          </td>
        </tr>
      `;
    }

    function clearUserExpiryFilters() {
      const statusFilter = document.getElementById('userExpiryStatusFilter');

      if (statusFilter) statusFilter.value = 'all';

      renderUserExpiryReport();
    }

    async function adminConfirmOrder(id) {
      if (!confirm(`Approve payment deposit for reference request #${id}?`)) return;
      try {
        const res = await fetch(`/admin/orders/${id}/confirm`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert('Payment confirmed & user plan activated successfully!');
        fetchAdminOrders();
      } catch (err) {
        alert(err.message);
      }
    }

    async function adminRejectOrder(id) {
      const notes = prompt('Enter a reason for rejecting this deposit reference:');
      if (notes === null) return; // cancelled

      try {
        const res = await fetch(`/admin/orders/${id}/reject`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${state.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ notes: notes || 'UTR verification failed / reference invalid.' })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert('Reference rejected.');
        fetchAdminOrders();
      } catch (err) {
        alert(err.message);
      }
    }

    // ADMIN TAB: manage users directory (with block/unblock)
    async function fetchAdminUsers() {
      const tableBody = document.querySelector('#adminUsersTable tbody');

      try {
        const res = await fetch('/admin/users', {
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();
        state.adminUsers = data.users || [];

        // 1. Calculate Statistics
        let totalBalance = 0;
        let activeCount = 0;
        let expiringSoonCount = 0;
        const now = Date.now();

        state.adminUsers.forEach(u => {
          if (u.role !== 'admin') {
            totalBalance += u.wallet_balance || 0;
          }
          if (u.plan_status === 'active') {
            activeCount++;
            if (u.expires_at) {
              const diffMs = new Date(u.expires_at).getTime() - now;
              const diffDays = diffMs / (24 * 60 * 60 * 1000);
              if (diffDays > 0 && diffDays <= 5) {
                expiringSoonCount++;
              }
            }
          }
        });

        // Update Stat Cards UI
        const balEl = document.getElementById('totalUserWalletBalance');
        if (balEl) balEl.textContent = `₹${totalBalance.toFixed(2)}`;
        const actEl = document.getElementById('totalActiveSubscriptions');
        if (actEl) actEl.textContent = activeCount;
        const expEl = document.getElementById('totalExpiringSoon');
        if (expEl) expEl.textContent = expiringSoonCount;

        // 2. Sort Users: Admins at the bottom, active plans expiring soonest at the top, then other active plans, then expired/no plans
        const sortedUsers = [...state.adminUsers].sort((a, b) => {
          if (a.role === 'admin' && b.role !== 'admin') return 1;
          if (a.role !== 'admin' && b.role === 'admin') return -1;
          
          const aActive = a.plan_status === 'active' && a.expires_at;
          const bActive = b.plan_status === 'active' && b.expires_at;
          
          if (aActive && !bActive) return -1;
          if (!aActive && bActive) return 1;
          
          if (aActive && bActive) {
            return new Date(a.expires_at) - new Date(b.expires_at); // ascending (expires soonest first)
          }
          
          return b.id - a.id;
        });

        if (tableBody) {
        tableBody.innerHTML = sortedUsers.map(u => `
          <tr>
            <td><code>${u.id}</code></td>
            <td><strong>${u.name}</strong></td>
            <td>
              ${u.email}<br>
              <span style="color: var(--text-muted); font-size: 0.75rem;">${u.phone || 'No phone'}</span>
            </td>
            <td><span class="badge ${u.role === 'admin' ? 'badge-active' : 'badge-none'}">${u.role}</span></td>
            <td><strong>₹${u.wallet_balance.toFixed(2)}</strong></td>
            <td>
              ${u.plan_status === 'active' ? `<span class="badge badge-active">Active</span>` : `<span class="badge badge-expired">Expired / None</span>`}
            </td>
            <td>${u.expires_at ? new Date(u.expires_at).toLocaleString() : '-'}</td>
            <td>
              ${u.role === 'admin' ? '<span style="color:var(--text-muted);">Admin (Bypassed)</span>' : `
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  ${u.is_blocked === 1 
                    ? `<span style="color:var(--error-color); font-weight:600; font-size:0.8rem;">Blocked</span>
                       <button onclick="adminSetBlock(${u.id}, false)" class="btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem; width:auto;">Allow Link</button>`
                    : `<span style="color:var(--accent-color); font-weight:600; font-size:0.8rem;">Allowed</span>
                       <button onclick="adminSetBlock(${u.id}, true)" class="btn-warn" style="padding:0.25rem 0.5rem; font-size:0.75rem; width:auto;">Block Link</button>`
                  }
                </div>
              `}
            </td>
            <td>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <button onclick="adminGenerateToken(${u.id})" style="padding:0.25rem 0.6rem; font-size:0.75rem; width:auto; background: linear-gradient(135deg,#6366f1,#8b5cf6); border:none; color:#fff; border-radius:6px; cursor:pointer;">🔑 Get Token</button>
                ${u.role === 'admin' ? '' : `
                  <button onclick="adminDeleteUser(${u.id})" style="padding:0.25rem 0.6rem; font-size:0.75rem; width:auto; background: var(--error-color); border:none; color:#fff; border-radius:6px; cursor:pointer;">🗑️ Delete</button>
                `}
              </div>
            </td>
          </tr>
        `).join('');
        }
      } catch (err) {
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--error-color);">Error: ${err.message}</td></tr>`;
      }
    }

    function renderExpiryReport() {
      const tableBody = document.querySelector('#adminExpiryReportTable tbody');
      if (!tableBody) return;

      const filterVal = document.getElementById('adminExpiryStatusFilter')?.value || 'all';
      const now = Date.now();

      // Exclude system admins
      const reportUsers = state.adminUsers.filter(u => u.role !== 'admin');

      // Apply filter
      const filtered = reportUsers.filter(u => {
        const isActive = u.plan_status === 'active' && u.expires_at && new Date(u.expires_at).getTime() > now;
        if (filterVal === 'active') return isActive;
        if (filterVal === 'deactive') return !isActive;
        return true;
      });

      if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No users found matching the filter.</td></tr>`;
        return;
      }

      tableBody.innerHTML = filtered.map(u => {
        const isActive = u.plan_status === 'active' && u.expires_at && new Date(u.expires_at).getTime() > now;
        let timeRemainingStr = '-';
        if (u.expires_at) {
          const diffMs = new Date(u.expires_at).getTime() - now;
          const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
          if (diffDays > 0) {
            timeRemainingStr = `<span style="color: var(--accent-color); font-weight: 600;">${diffDays} days left</span>`;
          } else {
            timeRemainingStr = `<span style="color: var(--error-color);">Expired ${Math.abs(diffDays)} days ago</span>`;
          }
        } else {
          timeRemainingStr = '<span style="color: var(--text-muted);">No active plan history</span>';
        }

        return `
          <tr>
            <td><code>${u.id}</code></td>
            <td><strong>${u.name}</strong></td>
            <td>
              ${u.email}<br>
              <span style="color: var(--text-muted); font-size: 0.75rem;">${u.phone || 'No phone'}</span>
            </td>
            <td>${u.expires_at ? new Date(u.expires_at).toLocaleString() : 'Never'}</td>
            <td>${timeRemainingStr}</td>
            <td>
              ${isActive 
                ? `<span class="badge badge-active">Active</span>` 
                : `<span class="badge badge-expired">Deactive</span>`
              }
            </td>
            <td>
              <button onclick="adminDeleteUser(${u.id})" style="padding:0.25rem 0.6rem; font-size:0.75rem; width:auto; background: var(--error-color); border:none; color:#fff; border-radius:6px; cursor:pointer;">Delete</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    async function adminSetBlock(userId, block) {
      if (!confirm(`Are you sure you want to ${block ? 'BLOCK' : 'UNBLOCK'} WhatsApp API and connection rights for user #${userId}?`)) return;
      try {
        const res = await fetch(`/admin/users/${userId}/block`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${state.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ is_blocked: block })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        alert(data.message);
        fetchAdminUsers();
      } catch (err) {
        alert(err.message);
      }
    }

    async function adminGenerateToken(userId) {
      const userName = state.adminUsers.find(u => u.id === userId)?.name || `#${userId}`;
      try {
        const res = await fetch(`/admin/users/${userId}/generate-token`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        // Show modal with token
        const modal = document.getElementById('tokenModal');
        const tokenDisplay = document.getElementById('tokenModalValue');
        const tokenUserLabel = document.getElementById('tokenModalUser');
        if (modal && tokenDisplay) {
          tokenUserLabel.textContent = `User: ${userName} (ID: ${userId})`;
          tokenDisplay.textContent = data.token;
          modal.style.display = 'flex';
        }
      } catch (err) {
        alert('Error generating token: ' + err.message);
      }
    }

    async function adminDeleteUser(userId) {
      const userName = state.adminUsers.find(u => u.id === userId)?.name || `#${userId}`;
      if (!confirm(`⚠️ WARNING: Are you sure you want to permanently delete user "${userName}" (ID: ${userId})?\nThis will delete all their plans, order history, wallet transactions, password reset tokens, and WhatsApp sessions. This action cannot be undone.`)) {
        return;
      }

      try {
        const res = await fetch(`/admin/users/${userId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert(data.message || 'User deleted successfully.');
        await fetchAdminUsers();
        if (state.currentTab === 'adminExpiryReportTab') {
          renderExpiryReport();
        }
      } catch (err) {
        alert('Error deleting user: ' + err.message);
      }
    }

    function closeTokenModal() {
      const modal = document.getElementById('tokenModal');
      if (modal) modal.style.display = 'none';
    }

    function copyToken() {
      const tokenDisplay = document.getElementById('tokenModalValue');
      if (!tokenDisplay) return;
      navigator.clipboard.writeText(tokenDisplay.textContent).then(() => {
        const btn = document.getElementById('copyTokenBtn');
        if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => btn.textContent = '📋 Copy Token', 2000); }
      }).catch(() => {
        alert('Copy failed. Please select and copy the token manually.');
      });
    }

    function copyUserApiToken() {
      const tokenDisplay = document.getElementById('userApiTokenValue');
      if (!tokenDisplay) return;
      navigator.clipboard.writeText(tokenDisplay.textContent.trim()).then(() => {
        const btn = document.getElementById('copyUserApiTokenBtn');
        if (btn) {
          btn.textContent = '✅ Copied!';
          setTimeout(() => btn.textContent = '📋 Copy Token', 2000);
        }
      }).catch(() => {
        alert('Copy failed. Please select and copy the token manually.');
      });
    }

    async function handleAdminCreateUser(e) {
      e.preventDefault();
      const name = document.getElementById('adminNewName').value.trim();
      const email = document.getElementById('adminNewEmail').value.trim();
      const phone = document.getElementById('adminNewPhone').value.trim();
      const password = document.getElementById('adminNewPassword').value;
      const role = document.getElementById('adminNewRole').value;

      try {
        const res = await fetch('/admin/users', {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${state.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name, email, phone, password, role })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert(data.message || 'Account created successfully!');
        
        // Reset inputs
        document.getElementById('adminNewName').value = '';
        document.getElementById('adminNewEmail').value = '';
        document.getElementById('adminNewPhone').value = '';
        document.getElementById('adminNewPassword').value = '';
        
        fetchAdminUsers();
      } catch (err) {
        alert(`Failed to create account: ${err.message}`);
      }
    }

    async function handleAdminCredit(e) {
      e.preventDefault();
      const userId = document.getElementById('creditUserId').value.trim();
      const amount = document.getElementById('creditAmount').value.trim();
      const description = document.getElementById('creditReason').value.trim();

      try {
        const res = await fetch('/admin/wallet/credit', {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${state.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ userId, amount, description })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert(`Wallet balance credited successfully!`);
        document.getElementById('creditUserId').value = '';
        document.getElementById('creditAmount').value = '';
        document.getElementById('creditReason').value = '';
        fetchAdminUsers();
      } catch (err) {
        alert(err.message);
      }
    }

    // ADMIN TAB: manage banks list (CRUD)
    async function fetchAdminBanks() {
      const tableBody = document.querySelector('#adminBanksTable tbody');
      if (!tableBody) return;

      try {
        const res = await fetch('/admin/banks', {
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();
        state.adminBanks = data.banks || [];
        
        tableBody.innerHTML = state.adminBanks.map(b => `
          <tr>
            <td>
              <strong>${b.bank_name}</strong>
            </td>
            <td>
              A/C: <code>${b.account_number}</code><br>
              IFSC: <code>${b.ifsc}</code><br>
              Holder: ${b.account_holder}
            </td>
            <td>
              ${b.is_active === 1 
                ? '<span class="badge badge-active">Active</span>' 
                : '<span class="badge badge-expired">Inactive</span>'
              }
            </td>
            <td>
              <div style="display:flex; gap:0.25rem;">
                <button onclick="editBankDetails(${b.id})" style="padding:0.25rem 0.5rem; font-size:0.75rem; background:var(--info-color); width:auto;">Edit</button>
                <button onclick="deleteBankDetails(${b.id})" class="btn-danger" style="padding:0.25rem 0.5rem; font-size:0.75rem; width:auto;">Delete</button>
              </div>
            </td>
          </tr>
        `).join('');
      } catch (err) {
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--error-color);">Error: ${err.message}</td></tr>`;
      }
    }

    function editBankDetails(id) {
      const bank = state.adminBanks.find(b => b.id === id);
      if (!bank) return;

      state.editingBankId = id;
      document.getElementById('bankFormTitle').textContent = `Edit Bank: ${bank.bank_name}`;
      document.getElementById('bankNameInput').value = bank.bank_name;
      document.getElementById('bankAccountInput').value = bank.account_number;
      document.getElementById('bankIfscInput').value = bank.ifsc;
      document.getElementById('bankHolderInput').value = bank.account_holder;
      document.getElementById('bankStatusInput').value = bank.is_active;
      
      document.getElementById('bankSubmitBtn').textContent = 'Save Bank Details';
      document.getElementById('bankCancelBtn').style.display = 'inline-flex';
    }

    function resetBankForm() {
      state.editingBankId = null;
      document.getElementById('bankFormTitle').textContent = 'Add New Bank Account';
      document.getElementById('bankNameInput').value = '';
      document.getElementById('bankAccountInput').value = '';
      document.getElementById('bankIfscInput').value = '';
      document.getElementById('bankHolderInput').value = '';
      document.getElementById('bankStatusInput').value = '1';
      
      document.getElementById('bankSubmitBtn').textContent = 'Create Bank Account';
      document.getElementById('bankCancelBtn').style.display = 'none';
    }

    async function handleBankSubmit(e) {
      e.preventDefault();
      const bank_name = document.getElementById('bankNameInput').value.trim();
      const account_number = document.getElementById('bankAccountInput').value.trim();
      const ifsc = document.getElementById('bankIfscInput').value.trim();
      const account_holder = document.getElementById('bankHolderInput').value.trim();
      const is_active = parseInt(document.getElementById('bankStatusInput').value);

      const payload = { bank_name, account_number, ifsc, account_holder, is_active };

      try {
        let res, data;
        if (state.editingBankId) {
          // Update
          res = await fetch(`/admin/banks/${state.editingBankId}`, {
            method: 'PUT',
            headers: { 
              'Authorization': `Bearer ${state.token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });
        } else {
          // Create
          res = await fetch('/admin/banks', {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${state.token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });
        }

        data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert(data.message || 'Bank account details saved!');
        resetBankForm();
        fetchAdminBanks();
        fetchUserProfile(); // Sync bank option lists
      } catch (err) {
        alert(`Failed to save bank: ${err.message}`);
      }
    }

    async function deleteBankDetails(id) {
      if (!confirm('Are you sure you want to delete this bank details config?')) return;
      try {
        const res = await fetch(`/admin/banks/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        alert(data.message);
        fetchAdminBanks();
        fetchUserProfile();
      } catch (err) {
        alert(err.message);
      }
    }

    // WHATSAPP CONTROLS (Only rendered/used by Subscribers with active plans)
    async function triggerLogin() {
      const qrContainer = document.getElementById('qrContainer');
      if (qrContainer) {
        qrContainer.innerHTML = `<div class="pulse" style="background-color: var(--warning-color); width: 16px; height: 16px; margin-bottom: 0.5rem;"></div><span style="font-size: 0.85rem; color: var(--text-muted);">Booting WhatsApp socket instance...</span>`;
      }
      updateWhatsappBadge('CONNECTING');

      try {
        const res = await fetch('/api/session/login', {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${state.token}`,
            'Content-Type': 'application/json'
          }
        });
        const data = await res.json();
        
        const msg = data.error ? `Failed: ${data.error}` : `Session triggered: ${data.status}`;
        alert(data.message || msg);
        
        handleWhatsappStateChange(data);
        startPollingWhatsappStatus();
      } catch (err) {
        alert(`Connection setup error: ${err.message}`);
        updateWhatsappBadge('DISCONNECTED');
      }
    }

    async function triggerLogout() {
      if (!confirm('Are you sure you want to log out and unlink this phone from WhatsApp servers?')) return;
      try {
        const res = await fetch('/api/session/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();
        alert(data.message || 'Logged out successfully');
        handleWhatsappStateChange({ status: 'DISCONNECTED' });
      } catch (err) {
        alert(`Logout error: ${err.message}`);
      }
    }

    function startPollingWhatsappStatus() {
      if (statusPollInterval) clearInterval(statusPollInterval);
      
      async function poll() {
        try {
          const res = await fetch('/api/session/status', {
            headers: { 'Authorization': `Bearer ${state.token}` }
          });
          if (res.status === 403) {
            stopPollingWhatsappStatus();
            fetchUserProfile();
            return;
          }
          const data = await res.json();
          handleWhatsappStateChange(data);

          if (data.status === 'CONNECTED') {
            clearInterval(statusPollInterval);
            statusPollInterval = setInterval(poll, 15000); // lower frequency once secure
          }
        } catch (e) {
          console.error('Status poll error:', e);
        }
      }

      poll();
      statusPollInterval = setInterval(poll, 2500);
    }

    function stopPollingWhatsappStatus() {
      if (statusPollInterval) {
        clearInterval(statusPollInterval);
        statusPollInterval = null;
      }
    }

    function updateWhatsappBadge(status) {
      const badge = document.getElementById('statusBadge');
      const text = document.getElementById('statusText');
      const disconnBtn = document.getElementById('disconnectSessionBtn');
      const sendMsgBtn = document.getElementById('sendMsgBtn');
      const sendMediaBtn = document.getElementById('sendMediaBtn');
      const sendGroupMsgBtn = document.getElementById('sendGroupMsgBtn');

      if (!badge) return;

      badge.className = 'badge';
      
      const active = (status === 'CONNECTED');
      if (sendMsgBtn) sendMsgBtn.disabled = !active;
      if (sendMediaBtn) sendMediaBtn.disabled = !active;
      if (sendGroupMsgBtn) sendGroupMsgBtn.disabled = !active;
      if (disconnBtn) disconnBtn.disabled = (status === 'DISCONNECTED');
      
      // Update bulk buttons if function exists
      if (typeof updateBulkCampaignControls === 'function') {
        updateBulkCampaignControls();
      }

      if (status === 'CONNECTED') {
        badge.classList.add('badge-active');
        text.textContent = 'Connected';
      } else if (status === 'QR') {
        badge.classList.add('badge-pending');
        text.textContent = 'Scan QR';
      } else if (status === 'CONNECTING') {
        badge.classList.add('badge-pending');
        text.textContent = 'Connecting';
      } else {
        badge.classList.add('badge-none');
        text.textContent = 'Disconnected';
      }
    }

    function handleWhatsappStateChange(data) {
      state.whatsappStatus = data.status;
      state.whatsappQr = data.qr;
      state.whatsappAccount = data.user;
      
      updateWhatsappBadge(data.status);

      const qrContainer = document.getElementById('qrContainer');
      const profileContainer = document.getElementById('profileContainer');

      if (!qrContainer) return;

      if (data.status === 'QR' && data.qr) {
        qrContainer.innerHTML = `
          <img class="qr-image" src="${data.qr}" alt="Scan QR Code">
          <span style="margin-top: 0.75rem; font-size: 0.85rem; color: var(--warning-color); font-weight: 600; text-align: center;">
            Open WhatsApp on your phone → Linked Devices → Link a Device
          </span>
        `;
        profileContainer.style.display = 'none';
      } else if (data.status === 'CONNECTED') {
        qrContainer.innerHTML = `
          <span style="color: var(--accent-color); font-weight: 600; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">
            <div class="pulse" style="background-color: var(--accent-color)"></div> Connection Secured
          </span>
          <span style="font-size: 0.85rem; color: var(--text-muted); text-align: center; margin-top: 0.4rem;">
            WhatsApp Messaging API engine is running in the background.
          </span>
        `;
        
        if (data.user) {
          profileContainer.style.display = 'flex';
          document.getElementById('profileName').textContent = data.user.name || 'Connected Device';
          document.getElementById('profileNumber').textContent = `Phone: +${data.user.phone}`;
          fetchOwnAvatar();
        }
      } else if (data.status === 'CONNECTING') {
        qrContainer.innerHTML = `
          <div class="pulse" style="background-color: var(--warning-color); width: 16px; height: 16px; margin-bottom: 0.5rem;"></div>
          <span style="font-size: 0.85rem; color: var(--text-muted);">Initializing WebSocket link...</span>
        `;
        profileContainer.style.display = 'none';
      } else {
        qrContainer.innerHTML = `
          <span style="color: var(--text-muted); font-size: 0.85rem; text-align: center;">
            Session disconnected. Click "Connect / Reload Session" to start.
          </span>
        `;
        profileContainer.style.display = 'none';
      }
    }

    async function fetchOwnAvatar() {
      try {
        const res = await fetch('/api/profile', {
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const profile = await res.json();
        const avatar = document.getElementById('profileAvatar');
        if (avatar && profile.profilePictureUrl) {
          avatar.src = profile.profilePictureUrl;
        }
      } catch (e) {
        console.error('Error loading own avatar:', e);
      }
    }

    async function sendMessage() {
      const to = document.getElementById('msgTo').value.trim();
      const message = document.getElementById('msgBody').value.trim();

      if (!to || !message) {
        alert('Please specify recipient and message body');
        return;
      }

      logToConsole('apiConsole', `Sending message to ${to}...`, 'system');
      try {
        const res = await fetch('/api/message/send', {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${state.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ to, message })
        });
        const data = await res.json();
        if (data.success) {
          logToConsole('apiConsole', `Success! Message ID: ${data.messageId}`);
          document.getElementById('msgBody').value = '';
        } else {
          logToConsole('apiConsole', `API Error: ${data.error}`, 'error');
        }
      } catch (err) {
        logToConsole('apiConsole', `Network/HTTP error: ${err.message}`, 'error');
      }
    }

    // BULK CAMPAIGN ACTIONS
    async function parseExcelFile() {
      const fileInput = document.getElementById('bulkExcelFile');
      const msgTemplate = document.getElementById('bulkMsgBody').value.trim();
      const delayInput = document.getElementById('bulkDelay');

      if (!fileInput || fileInput.files.length === 0) {
        alert('Please select an Excel file first.');
        return;
      }
      if (!msgTemplate) {
        alert('Please enter a message template.');
        return;
      }

      state.bulkDelay = parseInt(delayInput.value, 10) || 2;
      const file = fileInput.files[0];
      const formData = new FormData();
      formData.append('file', file);
      formData.append('message', msgTemplate);

      logToConsole('bulkConsole', `Uploading and parsing Excel file: ${file.name}...`, 'system');
      
      const parseBtn = document.getElementById('parseExcelBtn');
      if (parseBtn) parseBtn.disabled = true;

      try {
        const res = await fetch('/api/message/parse-excel', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${state.token}`
          },
          body: formData
        });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error || 'Failed to parse Excel file');

        state.bulkTasks = data.tasks;
        state.bulkCampaignIndex = 0;
        state.bulkCampaignStatus = 'idle';

        logToConsole('bulkConsole', `Excel parsed successfully! Found ${data.recipientCount} valid recipients. (Phone column: "${data.phoneColumnUsed}")`);

        // Render preview table
        renderBulkPreviewTable();
        updateBulkCampaignControls();

      } catch (err) {
        logToConsole('bulkConsole', `Parsing Error: ${err.message}`, 'error');
        alert(err.message);
      } finally {
        if (parseBtn) parseBtn.disabled = false;
      }
    }

    function renderBulkPreviewTable() {
      const container = document.getElementById('bulkPreviewContainer');
      if (!container) return;

      if (!state.bulkTasks || state.bulkTasks.length === 0) {
        container.innerHTML = '';
        return;
      }

      let html = `
        <div style="margin-top: 1rem; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 1rem;">
          <div style="font-weight: 600; margin-bottom: 0.5rem; font-size: 0.9rem;">Recipients Preview (${state.bulkTasks.length} rows)</div>
          <div class="table-container" style="max-height: 200px; overflow-y: auto;">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Recipient Phone</th>
                  <th>Message Preview</th>
                </tr>
              </thead>
              <tbody>
                ${state.bulkTasks.map(t => `
                  <tr>
                    <td>${t.id}</td>
                    <td><code>${t.phone}</code></td>
                    <td style="font-size: 0.8rem; color: var(--text-muted); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(t.message)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
      container.innerHTML = html;
    }

    function escapeHtml(text) {
      if (!text) return '';
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function updateBulkCampaignControls() {
      const startBtn = document.getElementById('startBulkBtn');
      const pauseBtn = document.getElementById('pauseBulkBtn');
      const stopBtn = document.getElementById('stopBulkBtn');
      const progressContainer = document.getElementById('bulkProgressContainer');
      const progressBar = document.getElementById('bulkProgressBar');
      const progressText = document.getElementById('bulkProgressText');

      if (!startBtn) return;

      const isConnected = state.whatsappStatus === 'CONNECTED';
      const hasTasks = state.bulkTasks && state.bulkTasks.length > 0;
      const status = state.bulkCampaignStatus;

      // Update Connection Warning Banner
      const warningBanner = document.getElementById('bulkConnectionWarning');
      if (warningBanner) {
        warningBanner.style.display = isConnected ? 'none' : 'flex';
      }

      // Start/Resume Button - Keep active even if not connected so user can click to trigger connection alert helper
      startBtn.disabled = !hasTasks || status === 'sending';
      if (status === 'paused') {
        startBtn.textContent = 'Resume Campaign';
      } else {
        startBtn.textContent = 'Start Bulk Campaign';
      }

      // Pause Button
      if (pauseBtn) pauseBtn.disabled = status !== 'sending';

      // Stop Button
      if (stopBtn) stopBtn.disabled = status !== 'sending' && status !== 'paused';

      // Progress bar visibility
      if (progressContainer) {
        if (status !== 'idle' || hasTasks) {
          progressContainer.style.display = 'block';
          const pct = hasTasks ? Math.round((state.bulkCampaignIndex / state.bulkTasks.length) * 100) : 0;
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressText) progressText.textContent = `Progress: ${state.bulkCampaignIndex} / ${state.bulkTasks.length} sent (${pct}%)`;
        } else {
          progressContainer.style.display = 'none';
        }
      }
    }

    function startBulkCampaign() {
      if (!state.bulkTasks || state.bulkTasks.length === 0) return;
      
      if (state.whatsappStatus !== 'CONNECTED') {
        alert('Error: WhatsApp is not connected. Please go to the "WhatsApp Connection" tab and link your device (scan QR code) before starting the campaign.');
        logToConsole('bulkConsole', 'Error: Cannot start campaign. WhatsApp is not connected.', 'error');
        return;
      }

      state.bulkCampaignStatus = 'sending';
      const delayInput = document.getElementById('bulkDelay');
      state.bulkDelay = parseInt(delayInput.value, 10) || 2;

      logToConsole('bulkConsole', `Campaign started. Delay: ${state.bulkDelay} seconds between messages.`, 'system');
      updateBulkCampaignControls();
      sendNextBulkMessage();
    }

    function pauseBulkCampaign() {
      state.bulkCampaignStatus = 'paused';
      logToConsole('bulkConsole', 'Campaign paused by user.', 'system');
      updateBulkCampaignControls();
    }

    function stopBulkCampaign() {
      state.bulkCampaignStatus = 'stopped';
      state.bulkCampaignIndex = 0;
      logToConsole('bulkConsole', 'Campaign stopped and reset.', 'system');
      updateBulkCampaignControls();
    }

    async function sendNextBulkMessage() {
      if (state.bulkCampaignStatus !== 'sending') {
        return; // Campaign is paused, stopped, or done
      }

      if (state.whatsappStatus !== 'CONNECTED') {
        state.bulkCampaignStatus = 'paused';
        logToConsole('bulkConsole', 'Error: WhatsApp connection lost. Campaign paused.', 'error');
        alert('Error: WhatsApp connection lost. Campaign paused. Please reconnect your session.');
        updateBulkCampaignControls();
        return;
      }

      if (state.bulkCampaignIndex >= state.bulkTasks.length) {
        state.bulkCampaignStatus = 'completed';
        logToConsole('bulkConsole', 'Campaign completed successfully! All messages sent.', 'system');
        state.bulkCampaignIndex = 0;
        updateBulkCampaignControls();
        return;
      }

      const task = state.bulkTasks[state.bulkCampaignIndex];
      logToConsole('bulkConsole', `[${state.bulkCampaignIndex + 1}/${state.bulkTasks.length}] Sending message to ${task.phone}...`, 'system');

      try {
        const res = await fetch('/api/message/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${state.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ to: task.phone, message: task.message })
        });
        const data = await res.json();
        
        if (data.success) {
          logToConsole('bulkConsole', `Sent successfully to ${task.phone}. Message ID: ${data.messageId}`, 'success');
        } else {
          logToConsole('bulkConsole', `Failed to send to ${task.phone}: ${data.error}`, 'error');
        }
      } catch (err) {
        logToConsole('bulkConsole', `Network/HTTP error for ${task.phone}: ${err.message}`, 'error');
      }

      // Move to next recipient
      state.bulkCampaignIndex++;
      updateBulkCampaignControls();

      // Schedule next message if still sending
      if (state.bulkCampaignStatus === 'sending') {
        setTimeout(sendNextBulkMessage, state.bulkDelay * 1000);
      }
    }

    // Media attachments
    function onMediaTypeChange() {
      const sel = document.getElementById('mediaTypeSelect');
      if (!sel) return;
      const type = sel.value;
      const fileOverride = document.getElementById('mediaFileNameGroup');
      const caption = document.getElementById('mediaCaptionGroup');
      if (fileOverride) fileOverride.style.display = type === 'document' ? 'block' : 'none';
      if (caption) caption.style.display = type === 'audio' ? 'none' : 'block';
    }

    function toggleMediaSource(source) {
      const urlGrp = document.getElementById('mediaUrlGroup');
      const fileGrp = document.getElementById('mediaFileGroup');
      if (urlGrp && fileGrp) {
        urlGrp.style.display = source === 'url' ? 'block' : 'none';
        fileGrp.style.display = source === 'file' ? 'block' : 'none';
      }
    }

    async function sendMedia() {
      const to = document.getElementById('mediaTo').value.trim();
      const mediaType = document.getElementById('mediaTypeSelect').value;
      const caption = document.getElementById('mediaCaption').value.trim();
      const fileName = document.getElementById('mediaFileName').value.trim();
      const source = document.querySelector('input[name="mediaSource"]:checked').value;

      if (!to) {
        alert('Please enter recipient JID/Phone number');
        return;
      }

      let mediaUrl = '';

      if (source === 'file') {
        const fileInput = document.getElementById('mediaFile');
        if (fileInput.files.length === 0) {
          alert('Please select a file to upload');
          return;
        }
        const file = fileInput.files[0];
        logToConsole('mediaConsole', `Reading file: ${file.name} (${Math.round(file.size/1024)} KB)...`, 'system');
        
        try {
          mediaUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('File reading error'));
            reader.readAsDataURL(file);
          });
        } catch (err) {
          logToConsole('mediaConsole', err.message, 'error');
          return;
        }
      } else {
        mediaUrl = document.getElementById('mediaUrl').value.trim();
        if (!mediaUrl) {
          alert('Please enter the file link URL');
          return;
        }
      }

      logToConsole('mediaConsole', `Transmitting media packet (${mediaType}) to ${to}...`, 'system');
      const btn = document.getElementById('sendMediaBtn');
      if (btn) btn.disabled = true;

      try {
        const res = await fetch('/api/message/send', {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${state.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ to, mediaUrl, mediaType, caption, fileName })
        });
        const raw = await res.text();
        let data;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch (parseErr) {
          throw new Error(`Server returned non-JSON response (${res.status}). ${raw.slice(0, 120)}`);
        }
        if (!res.ok) {
          throw new Error(data.error || `Server error ${res.status}`);
        }
        if (data.success) {
          logToConsole('mediaConsole', `Success! Message ID: ${data.messageId}`);
          document.getElementById('mediaCaption').value = '';
          document.getElementById('mediaFileName').value = '';
          document.getElementById('mediaUrl').value = '';
          document.getElementById('mediaFile').value = '';
        } else {
          logToConsole('mediaConsole', `API Error: ${data.error}`, 'error');
        }
      } catch (err) {
        logToConsole('mediaConsole', `Error sending: ${err.message}`, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function loadGroups() {
      try {
        const res = await fetch('/api/groups', {
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const select = document.getElementById('groupSelect');
        if (!select) return;

        select.innerHTML = '<option value="">-- Choose target group --</option>';
        if (data.groups && data.groups.length > 0) {
          data.groups.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = `${g.name} (${g.participantsCount} members)`;
            select.appendChild(opt);
          });
          alert(`Fetched ${data.groups.length} groups.`);
        } else {
          alert('No groups found on this account.');
        }
      } catch (err) {
        alert(`Failed to load groups: ${err.message}`);
      }
    }

    function onGroupSelectChange() {
      const select = document.getElementById('groupSelect');
      const btn = document.getElementById('sendGroupMsgBtn');
      if (select && btn) {
        btn.disabled = !select.value;
      }
    }

    async function sendGroupMessage() {
      const groupId = document.getElementById('groupSelect').value;
      const message = document.getElementById('groupMsgBody').value.trim();

      if (!groupId || !message) {
        alert('Select group and type message');
        return;
      }

      try {
        const res = await fetch('/api/groups/send', {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${state.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ groupId, message })
        });
        const data = await res.json();
        if (data.success) {
          alert('Group message dispatched!');
          document.getElementById('groupMsgBody').value = '';
        } else {
          alert(`Failed: ${data.error}`);
        }
      } catch (err) {
        alert(err.message);
      }
    }

    async function lookupProfile() {
      const phone = document.getElementById('lookupPhone').value.trim();
      const div = document.getElementById('lookupResult');
      const avatar = document.getElementById('lookupAvatar');
      const phoneText = document.getElementById('lookupResultPhone');
      const picText = document.getElementById('lookupResultPic');

      if (!div) return;

      try {
        const res = await fetch(`/api/profile?phone=${phone}`, {
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();
        
        div.style.display = 'flex';
        phoneText.textContent = `Phone: +${data.phone}`;

        if (data.profilePictureUrl) {
          avatar.src = data.profilePictureUrl;
          picText.innerHTML = `<a href="${data.profilePictureUrl}" target="_blank" style="color: var(--accent-color);">View Full Profile Picture</a>`;
        } else {
          avatar.src = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
          picText.textContent = 'No avatar found (Privacy settings may block it)';
        }
      } catch (err) {
        alert(`Lookup error: ${err.message}`);
      }
    }

    function syncSubTabState() {
      // Re-trigger visual changes of input fields
      onMediaTypeChange();
      toggleMediaSource('url');
      
      if (state.whatsappSubTab === 'bulkTab') {
        renderBulkPreviewTable();
        updateBulkCampaignControls();
      }
    }

    function logToConsole(consoleId, message, type = 'success') {
      const el = document.getElementById(consoleId);
      if (!el) return;
      const line = document.createElement('div');
      line.className = `console-line ${type}`;
      const time = new Date().toLocaleTimeString();
      line.textContent = `[${time}] ${message}`;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }

    function clearConsole(consoleId) {
      const el = document.getElementById(consoleId);
      if (el) el.innerHTML = '<div class="console-line system">[System] Console logs cleared.</div>';
    }

    // Bootstrap
    renderApp();
  