/**
 * LoliMod-İDEA — Authentication, Live Stats & Download Tracking Engine
 */

(function () {
    const STORAGE_KEY_USER = 'lolimod_user';
    const STORAGE_KEY_TOKEN = 'lolimod_token';

    const LoliAuth = {
        currentUser: null,
        token: null,
        stats: { downloads: 20, registeredUsers: 10 },

        init() {
            this.loadStoredAuth();
            this.createToastContainer();
            this.createAuthModal();
            this.createStatsModal();
            this.setupDownloadTracking();
            this.renderNavSlots();
            this.fetchStats();

            // Refresh stats every 15 seconds
            setInterval(() => this.fetchStats(), 15000);

            // Listen for storage events (multi-tab sync)
            window.addEventListener('storage', (e) => {
                if (e.key === STORAGE_KEY_USER || e.key === STORAGE_KEY_TOKEN) {
                    this.loadStoredAuth();
                    this.renderNavSlots();
                    window.dispatchEvent(new CustomEvent('lolimod:authchange', { detail: { user: this.currentUser } }));
                }
            });
        },

        loadStoredAuth() {
            try {
                const storedUser = localStorage.getItem(STORAGE_KEY_USER);
                const storedToken = localStorage.getItem(STORAGE_KEY_TOKEN);
                if (storedUser && storedToken) {
                    this.currentUser = JSON.parse(storedUser);
                    this.token = storedToken;
                } else {
                    this.currentUser = null;
                    this.token = null;
                }
            } catch (e) {
                this.currentUser = null;
                this.token = null;
            }
        },

        saveAuth(user, token) {
            this.currentUser = user;
            this.token = token;
            localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
            localStorage.setItem(STORAGE_KEY_TOKEN, token);
            this.renderNavSlots();
            window.dispatchEvent(new CustomEvent('lolimod:authchange', { detail: { user } }));
        },

        clearAuth() {
            this.currentUser = null;
            this.token = null;
            localStorage.removeItem(STORAGE_KEY_USER);
            localStorage.removeItem(STORAGE_KEY_TOKEN);
            this.renderNavSlots();
            window.dispatchEvent(new CustomEvent('lolimod:authchange', { detail: { user: null } }));
        },

        isLoggedIn() {
            return !!this.currentUser && !!this.token;
        },

        async fetchStats() {
            try {
                const res = await fetch('/api/stats');
                if (res.ok) {
                    const data = await res.json();
                    if (data.success) {
                        this.stats = {
                            downloads: data.downloads,
                            registeredUsers: data.registeredUsers
                        };
                        this.updateStatsUI();
                    }
                }
            } catch (err) {
                // Fallback offline mock update
            }
        },

        updateStatsUI() {
            const formattedDownloads = Number(this.stats.downloads).toLocaleString('tr-TR');
            const formattedUsers = Number(this.stats.registeredUsers).toLocaleString('tr-TR');

            document.querySelectorAll('.live-downloads').forEach(el => {
                el.textContent = formattedDownloads;
            });

            document.querySelectorAll('.live-users').forEach(el => {
                el.textContent = formattedUsers;
            });

            const statDownloadsModal = document.getElementById('modalStatDownloads');
            if (statDownloadsModal) statDownloadsModal.textContent = formattedDownloads;

            const statUsersModal = document.getElementById('modalStatUsers');
            if (statUsersModal) statUsersModal.textContent = formattedUsers;
        },

        setupDownloadTracking() {
            document.addEventListener('click', (e) => {
                const target = e.target.closest('a[download], [data-download-button], a[href*="Installer.exe"], a[href*="İnstaller.exe"]');
                if (target) {
                    this.trackDownload();
                }
            });
        },

        async trackDownload() {
            this.stats.downloads += 1;
            this.updateStatsUI();
            this.showToast('🚀 İndirme Başlatıldı!', 'Loli-Mod-2.0.1 Installer indiriliyor. Canlı sayaç güncellendi.', 'success');

            try {
                const res = await fetch('/api/download-click', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ platform: 'Windows x64' })
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.downloads) {
                        this.stats.downloads = data.downloads;
                        this.updateStatsUI();
                    }
                }
            } catch (err) {
                console.error('Download track request failed:', err);
            }
        },

        renderNavSlots() {
            const slots = document.querySelectorAll('.auth-nav-slot');
            slots.forEach(slot => {
                slot.innerHTML = '';
                const container = document.createElement('div');
                container.className = 'auth-nav-container';

                if (this.isLoggedIn()) {
                    const user = this.currentUser;
                    const initial = (user.username || 'U')[0].toUpperCase();

                    container.innerHTML = `
                        <div class="user-badge-pill" id="userMenuBtn">
                            <div class="user-avatar-circle">${initial}</div>
                            <span>${escapeHtml(user.username)}</span>
                            <span class="user-pro-tag">VIP</span>
                            <span style="font-size: 10px; opacity: 0.7;">▼</span>

                            <div class="user-dropdown-menu" id="userMenuDropdown">
                                <div class="user-dropdown-header">
                                    <div class="user-dropdown-name">${escapeHtml(user.username)}</div>
                                    <div class="user-dropdown-status">
                                        <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#00f090;"></span>
                                        20.000 Kod Aktif
                                    </div>
                                </div>
                                <a href="help.html" class="user-dropdown-item">
                                    <span>⚡</span> Kod Kütüphanesi (20k)
                                </a>
                                <button class="user-dropdown-item" onclick="window.LoliAuth.openStats()">
                                    <span>📊</span> Canlı İstatistikler
                                </button>
                                <button class="user-dropdown-item logout" onclick="window.LoliAuth.handleLogout()">
                                    <span>🚪</span> Çıkış Yap
                                </button>
                            </div>
                        </div>
                    `;

                    // Toggle user dropdown
                    const userMenuBtn = container.querySelector('#userMenuBtn');
                    const dropdown = container.querySelector('#userMenuDropdown');
                    userMenuBtn.addEventListener('click', (e) => {
                        if (e.target.closest('.user-dropdown-item')) return;
                        e.stopPropagation();
                        dropdown.classList.toggle('active');
                    });

                } else {
                    container.innerHTML = `
                        <button class="auth-btn-login" onclick="window.LoliAuth.openAuth('login')">
                            <span>🔑</span>
                            <span data-tr="Giriş Yap" data-en="Sign In">Giriş Yap</span>
                        </button>
                    `;
                }

                slot.appendChild(container);
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', () => {
                document.querySelectorAll('.user-dropdown-menu.active').forEach(menu => {
                    menu.classList.remove('active');
                });
            });
        },

        createToastContainer() {
            if (document.getElementById('loliToastContainer')) return;
            const container = document.createElement('div');
            container.id = 'loliToastContainer';
            container.className = 'loli-toast-container';
            document.body.appendChild(container);
        },

        showToast(title, desc, type = 'info') {
            const container = document.getElementById('loliToastContainer') || document.body;
            const toast = document.createElement('div');
            toast.className = 'loli-toast';

            let icon = '⚡';
            if (type === 'success') icon = '✅';
            if (type === 'error') icon = '❌';

            toast.innerHTML = `
                <div class="loli-toast-icon">${icon}</div>
                <div class="loli-toast-content">
                    <div class="loli-toast-title">${escapeHtml(title)}</div>
                    <div class="loli-toast-desc">${escapeHtml(desc)}</div>
                </div>
            `;

            container.appendChild(toast);
            requestAnimationFrame(() => toast.classList.add('show'));

            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 400);
            }, 3500);
        },

        createAuthModal() {
            if (document.getElementById('loliAuthModal')) return;
            const overlay = document.createElement('div');
            overlay.id = 'loliAuthModal';
            overlay.className = 'loli-modal-overlay';
            overlay.innerHTML = `
                <div class="loli-modal-card">
                    <button class="loli-modal-close" onclick="window.LoliAuth.closeAuth()">&times;</button>
                    
                    <div class="loli-modal-header">
                        <img src="icon.ico" class="loli-modal-icon" alt="LoliMod">
                        <div class="loli-modal-title" id="authModalTitle">LoliMod-İDEA Hesabı</div>
                        <div class="loli-modal-subtitle">Giriş yaparak 20.000 hazır kod kütüphanesini ve VIP geliştirici araçlarını açın.</div>
                    </div>

                    <div class="loli-modal-tabs">
                        <button class="loli-modal-tab active" id="tabBtnLogin" onclick="window.LoliAuth.switchTab('login')">Giriş Yap</button>
                        <button class="loli-modal-tab" id="tabBtnRegister" onclick="window.LoliAuth.switchTab('register')">Kayıt Ol</button>
                    </div>

                    <div class="loli-auth-alert" id="authAlertBox"></div>

                    <!-- Login Form -->
                    <form id="loliLoginForm" onsubmit="window.LoliAuth.handleLoginSubmit(event)">
                        <div class="loli-form-group">
                            <label class="loli-form-label">Kullanıcı Adı veya E-posta</label>
                            <input type="text" class="loli-form-input" id="loginUsername" placeholder="Örn: modder123" required autocomplete="username">
                        </div>
                        <div class="loli-form-group">
                            <label class="loli-form-label">Şifre</label>
                            <input type="password" class="loli-form-input" id="loginPassword" placeholder="••••••••" required autocomplete="current-password">
                        </div>
                        <button type="submit" class="loli-submit-btn" id="loginSubmitBtn">
                            <span>Giriş Yap</span>
                            <span>→</span>
                        </button>
                    </form>

                    <!-- Register Form -->
                    <form id="loliRegisterForm" style="display: none;" onsubmit="window.LoliAuth.handleRegisterSubmit(event)">
                        <div class="loli-form-group">
                            <label class="loli-form-label">Kullanıcı Adı</label>
                            <input type="text" class="loli-form-input" id="regUsername" placeholder="En az 3 karakter" required autocomplete="username">
                        </div>
                        <div class="loli-form-group">
                            <label class="loli-form-label">E-posta (İsteğe bağlı)</label>
                            <input type="email" class="loli-form-input" id="regEmail" placeholder="ornek@minecraft.com" autocomplete="email">
                        </div>
                        <div class="loli-form-group">
                            <label class="loli-form-label">Şifre</label>
                            <input type="password" class="loli-form-input" id="regPassword" placeholder="En az 4 karakter" required autocomplete="new-password">
                        </div>
                        <button type="submit" class="loli-submit-btn" id="regSubmitBtn">
                            <span>Kayıt Ol & 20.000 Kodu Aç</span>
                            <span>✨</span>
                        </button>
                    </form>

                    <div class="loli-auth-perks">
                        <span>⭐</span>
                        <span>Hesap açtığınızda <strong>20.000 hazır kod</strong> kütüphanesi anında profilinize tanımlanır. Tamamen ücretsizdir.</span>
                    </div>
                </div>
            `;

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.closeAuth();
            });

            document.body.appendChild(overlay);
        },

        createStatsModal() {
            if (document.getElementById('loliStatsModal')) return;
            const overlay = document.createElement('div');
            overlay.id = 'loliStatsModal';
            overlay.className = 'loli-modal-overlay';
            overlay.innerHTML = `
                <div class="loli-modal-card">
                    <button class="loli-modal-close" onclick="window.LoliAuth.closeStats()">&times;</button>
                    
                    <div class="loli-modal-header">
                        <div style="font-size: 38px; margin-bottom: 10px;">📊</div>
                        <div class="loli-modal-title">Canlı İstatistik Merkezi</div>
                        <div class="loli-modal-subtitle">LoliMod-İDEA ekosisteminin gerçek zamanlı kullanım verileri.</div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px;">
                        <div style="background: rgba(8, 13, 24, 0.85); border: 1px solid rgba(0, 229, 255, 0.25); border-radius: 16px; padding: 16px; text-align: center;">
                            <div style="color: #00e5ff; font-size: 28px; font-weight: 850;" id="modalStatDownloads" class="live-downloads">
                                ${this.stats.downloads.toLocaleString('tr-TR')}
                            </div>
                            <div style="font-size: 11px; color: #8fa0be; text-transform: uppercase; margin-top: 6px; font-weight: 700;">
                                Toplam İndirme
                            </div>
                        </div>

                        <div style="background: rgba(8, 13, 24, 0.85); border: 1px solid rgba(0, 240, 144, 0.25); border-radius: 16px; padding: 16px; text-align: center;">
                            <div style="color: #00f090; font-size: 28px; font-weight: 850;" id="modalStatUsers" class="live-users">
                                ${this.stats.registeredUsers.toLocaleString('tr-TR')}
                            </div>
                            <div style="font-size: 11px; color: #8fa0be; text-transform: uppercase; margin-top: 6px; font-weight: 700;">
                                Kayıtlı Geliştirici
                            </div>
                        </div>
                    </div>

                    <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 14px; font-size: 12px; color: #cbd5e1; line-height: 1.6;">
                        <div style="display:flex; justify-content:space-between; margin-bottom: 6px;">
                            <span>Sürüm:</span>
                            <span style="color:#ffffff; font-weight:700;">v2.0.1 (Windows x64)</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; margin-bottom: 6px;">
                            <span>Kod Kütüphanesi:</span>
                            <span style="color:#00f090; font-weight:700;">20.000 Hazır Şablon</span>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span>Sunucu Durumu:</span>
                            <span style="color:#00e5ff; font-weight:700;">● Aktif & Senkronize</span>
                        </div>
                    </div>

                    <button class="loli-submit-btn" style="margin-top: 18px;" onclick="window.LoliAuth.closeStats()">
                        Pencereyi Kapat
                    </button>
                </div>
            `;

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.closeStats();
            });

            document.body.appendChild(overlay);
        },

        openAuth(tab = 'login') {
            const modal = document.getElementById('loliAuthModal');
            if (modal) {
                this.switchTab(tab);
                this.clearAlert();
                modal.classList.add('active');
            }
        },

        closeAuth() {
            const modal = document.getElementById('loliAuthModal');
            if (modal) modal.classList.remove('active');
        },

        openStats() {
            this.fetchStats();
            const modal = document.getElementById('loliStatsModal');
            if (modal) modal.classList.add('active');
        },

        closeStats() {
            const modal = document.getElementById('loliStatsModal');
            if (modal) modal.classList.remove('active');
        },

        switchTab(tab) {
            const tabLogin = document.getElementById('tabBtnLogin');
            const tabReg = document.getElementById('tabBtnRegister');
            const formLogin = document.getElementById('loliLoginForm');
            const formReg = document.getElementById('loliRegisterForm');
            this.clearAlert();

            if (tab === 'login') {
                tabLogin.classList.add('active');
                tabReg.classList.remove('active');
                formLogin.style.display = 'block';
                formReg.style.display = 'none';
            } else {
                tabLogin.classList.remove('active');
                tabReg.classList.add('active');
                formLogin.style.display = 'none';
                formReg.style.display = 'block';
            }
        },

        showAlert(msg, type = 'error') {
            const alert = document.getElementById('authAlertBox');
            if (alert) {
                alert.className = `loli-auth-alert ${type}`;
                alert.textContent = msg;
            }
        },

        clearAlert() {
            const alert = document.getElementById('authAlertBox');
            if (alert) {
                alert.className = 'loli-auth-alert';
                alert.textContent = '';
                alert.style.display = 'none';
            }
        },

        async handleLoginSubmit(e) {
            e.preventDefault();
            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value;
            const btn = document.getElementById('loginSubmitBtn');

            btn.disabled = true;
            btn.innerHTML = '<span>Giriş Yapılıyor...</span>';

            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();

                if (data.success && data.user) {
                    this.saveAuth(data.user, data.token);
                    this.closeAuth();
                    this.showToast('🎉 Hoş Geldiniz!', `${data.user.username}, 20.000 hazır kod kütüphanesi aktif edildi!`, 'success');
                } else {
                    this.showAlert(data.message || 'Giriş başarısız!');
                }
            } catch (err) {
                // Offline demo fallback
                if (username.toLowerCase() === 'demo') {
                    const demoUser = { id: 'usr_demo', username: 'demo', email: 'demo@lolimod.dev', isPro: true };
                    this.saveAuth(demoUser, 'token_demo');
                    this.closeAuth();
                    this.showToast('🎉 Hoş Geldiniz!', 'Demo kullanıcı ile 20.000 kod kütüphanesi açıldı!', 'success');
                } else {
                    this.showAlert('Sunucuya bağlanılamadı. Lütfen tekrar deneyin.');
                }
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>Giriş Yap</span> <span>→</span>';
            }
        },

        async handleRegisterSubmit(e) {
            e.preventDefault();
            const username = document.getElementById('regUsername').value.trim();
            const email = document.getElementById('regEmail').value.trim();
            const password = document.getElementById('regPassword').value;
            const btn = document.getElementById('regSubmitBtn');

            btn.disabled = true;
            btn.innerHTML = '<span>Hesap Oluşturuluyor...</span>';

            try {
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, email, password })
                });
                const data = await res.json();

                if (data.success && data.user) {
                    this.saveAuth(data.user, data.token);
                    if (data.registeredUsers) {
                        this.stats.registeredUsers = data.registeredUsers;
                        this.updateStatsUI();
                    }
                    this.closeAuth();
                    this.showToast('🚀 Kayıt Başarılı!', `Tebrikler ${data.user.username}! 20.000 kod açıldı.`, 'success');
                } else {
                    this.showAlert(data.message || 'Kayıt işlemi başarısız.');
                }
            } catch (err) {
                this.showAlert('Sunucuya bağlanırken hata oluştu.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>Kayıt Ol & 20.000 Kodu Aç</span> <span>✨</span>';
            }
        },

        handleLogout() {
            this.clearAuth();
            this.showToast('Çıkış Yapıldı', 'Misafir moduna geçildi (10.000 kod kütüphanesi).', 'info');
        }
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    window.LoliAuth = LoliAuth;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => LoliAuth.init());
    } else {
        LoliAuth.init();
    }
})();
