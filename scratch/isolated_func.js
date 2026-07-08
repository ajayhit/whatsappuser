function renderUserDashboard() {
      const hasActivePlan = state.plan && state.plan.status === 'active' && new Date(state.plan.expires_at) > new Date();

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
                  ${hasActivePlan ? `<span style="font-size: 0.75rem; font-weight: normal; color: var(--accent-color); background: rgba(16, 185, 129, 0.1); border: 1px solid var(--accent-color); padding: 0.2rem 0.6rem; border-radius: 9999px; letter-spacing: 0.05em;">SUBSCRIPTION ACTIVE</span>` : ''}
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">
                  ${state.planOptions ? state.planOptions.map(plan => {
                    const isDemo = plan.type === 'demo';
                    let btnText = isDemo ? 'Claim Demo (10d)' : 'Subscribe Now';
                    let btnClass = isDemo ? 'btn-secondary' : '';
                    let btnAttrs = '';
                    
                    const alreadyClaimedDemo = isDemo && state.plans && state.plans.some(p => p.plan_type === 'demo');
                    if (alreadyClaimedDemo) {
                      btnText = 'Trial Claimed';
                      btnClass = 'btn-secondary';
                      btnAttrs = 'disabled style="opacity: 0.5; cursor: not-allowed;"';
                    }

                    return `
                      <div class="card" style="margin: 0; background: rgba(15, 23, 42, 0.4); border: 1px solid ${isDemo ? 'rgba(59, 130, 246, 0.25)' : 'var(--glass-border)'}; display: flex; flex-direction: column; justify-content: space-between; gap: 1rem; padding: 1rem; border-radius: 10px;">
                        <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                          <div style="font-weight: 700; font-size: 0.95rem; color: ${isDemo ? '#60a5fa' : 'var(--text-main)'};">${plan.name}</div>
                          <div style="font-size: 0.75rem; color: var(--text-muted);">${plan.durationDays} Days Duration</div>
                          <div style="font-size: 1.4rem; font-weight: 800; color: var(--accent-color); margin-top: 0.4rem;">
                            ₹${plan.price}
                          </div>
                        </div>
                        <button type="button" class="${btnClass}" ${btnAttrs} onclick="purchasePlan('${plan.type}', ${plan.price}, ${plan.durationDays})" style="width: 100%; font-size: 0.8rem; padding: 0.4rem 0.8rem; margin: 0;">
                          ${btnText}
                        </button>
                      </div>
                    `;
                  }).join('') : '<div style="text-align: center; color: var(--text-muted);">No plans available</div>'}
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