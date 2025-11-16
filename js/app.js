// Main application entry point

class SalonPOSApp {
  constructor() {
    this.database = null;
    this.posLogic = null;
    const existingState = window.stateManager;
    if (existingState) {
      this.stateManager = existingState;
    } else if (window.StateManager) {
      this.stateManager = new window.StateManager();
      window.stateManager = this.stateManager;
    } else {
      throw new Error('StateManager no disponible');
    }
    this.initialized = false;
    this.paymentForm = null;
    this.currentTotals = null;
  }

  async init() {
    try {
      UIComponents.showLoading('Iniciando sistema...');
      
      // Initialize database (use static Database helper)
      this.database = Database;
      await this.database.open();
      await this.database.seed();
      
      // Initialize POS logic
      this.posLogic = new POSLogic(this.stateManager, this.database);
      
      // Load initial data
      await this.loadInitialData();
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Render initial UI
      this.renderInitialUI();
      
      // Setup state change listeners
      this.setupStateListeners();
      
      this.initialized = true;
      UIComponents.hideLoading();
      
      console.log('Salon POS System initialized successfully');
    } catch (error) {
      UIComponents.hideLoading();
      console.error('Failed to initialize Salon POS System:', error);
      Utils.toast('Error al iniciar el sistema: ' + error.message, 'err');
    }
  }

  async loadInitialData() {
    try {
      // Load settings
      const settings = await this.database.getById('settings', 'main');
      if (settings) {
        this.settings = settings;
      }

      // Load initial data for POS
      this.products = await this.database.getAll('products');
      this.variants = await this.database.getAll('variants');
      this.customers = await this.database.getAll('customers');
      this.stylists = await this.database.getAll('stylists');
      
      // Load payment methods from settings
      this.paymentMethods = this.settings?.payment_methods || ['Efectivo', 'Tarjeta', 'Transferencia'];
    } catch (error) {
      console.error('Error loading initial data:', error);
      throw error;
    }
  }

  setupEventListeners() {
    // Tab navigation
    window.setActive = (tabId) => {
      this.stateManager.setActiveTab(tabId);
    };

    // POS functions
    window.selectVariant = async (variantId) => {
      const added = await this.posLogic.addVariant(variantId);
      if (added) {
        await this.renderPOS();
      }
    };

    window.selectCustomer = async (customerId) => {
      await this.posLogic.setCustomer(customerId);
      await this.renderPOS();
    };

    window.toggleStylist = (stylistId) => {
      const pos = this.stateManager.pos;
      const stylists = pos.stylistsGlobal || [];
      const existing = stylists.find(s => s.id === stylistId);
      
      if (existing) {
        // Remove if already selected
        pos.stylistsGlobal = stylists.filter(s => s.id !== stylistId);
      } else {
        // Add with default percentage
        const stylist = this.stylists.find(s => s.id === stylistId);
        if (stylist) {
          pos.stylistsGlobal = Utils.autoBalance([
            ...stylists,
            {id: stylist.id, nombre: stylist.nombre, pct: 0}
          ]);
        }
      }
      
      this.stateManager.setStylistsGlobal(pos.stylistsGlobal);
      this.renderPOS();
    };

    window.editLine = (lineIndex) => {
      // TODO: Implement line editing modal
      console.log('Edit line:', lineIndex);
    };

    window.removeLine = (lineIndex) => {
      this.posLogic.removeLine(lineIndex);
      this.renderPOS();
    };

    window.viewOrder = async (orderId) => {
      // TODO: Implement order view modal
      console.log('View order:', orderId);
    };

    window.printOrder = async (orderId) => {
      // TODO: Implement order printing
      console.log('Print order:', orderId);
    };

    window.closeCommissionModal = () => {
      const overlay = Utils.$('#comiOverlay');
      if (overlay) {
        overlay.classList.remove('show');
      }
    };

    window.exportCommissions = async () => {
      // TODO: Implement commission export
      console.log('Export commissions');
    };

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 's':
            e.preventDefault();
            this.saveCurrentState();
            break;
          case 'p':
            e.preventDefault();
            this.printCurrentTicket();
            break;
        }
      }
    });

    // Auto-save periodically
    setInterval(() => {
      this.saveCurrentState();
    }, 30000); // Every 30 seconds
  }

  setupStateListeners() {
    // Listen for tab changes
    this.stateManager.on('activeTabChanged', (tabId) => {
      this.renderMain(tabId);
      this.renderNav();
    });

    // Listen for POS changes
    this.stateManager.on('posUpdated', () => {
      if (this.stateManager.activeTab === 'pos') {
        this.renderPOS();
      }
    });

    // Listen for lines changes
    this.stateManager.on('linesChanged', async () => {
      if (this.stateManager.activeTab === 'pos') {
        this.renderTicketLines();
        await this.renderTotals();
        await this.renderPaymentMethods(this.currentTotals);
      }
    });

    this.stateManager.on('paymentsChanged', async () => {
      if (this.stateManager.activeTab === 'pos') {
        await this.renderPaymentMethods(this.currentTotals);
      }
    });
  }

  renderInitialUI() {
    this.renderHeader();
    this.renderFooter();
    this.renderNav();
    this.renderMain(this.stateManager.activeTab);
  }

  renderHeader() {
    const salonName = this.settings?.salon || 'The beauty salón by alan';
    const firma = this.settings?.firma || 'contacto@gammaconsultores.mx';
    UIComponents.renderHeader(salonName, firma);
  }

  renderFooter() {
    const firma = this.settings?.firma || 'contacto@gammaconsultores.mx';
    UIComponents.renderFooter(firma);
  }

  renderNav() {
    UIComponents.renderNav(
      this.stateManager.activeTab,
      this.stateManager.tabs,
      (tabId) => this.stateManager.setActiveTab(tabId)
    );
  }

  async renderMain(tabId) {
    const main = Utils.$('#main');
    if (!main) return;

    try {
      switch (tabId) {
        case 'pos':
          await this.renderPOS();
          break;
        case 'orders':
          await this.renderOrders();
          break;
        case 'customers':
          await this.renderCustomers();
          break;
        case 'stylists':
          await this.renderStylists();
          break;
        case 'expenses':
          await this.renderExpenses();
          break;
        case 'purchases':
          await this.renderPurchases();
          break;
        case 'suppliers':
          await this.renderSuppliers();
          break;
        case 'payroll':
          await this.renderPayroll();
          break;
        case 'reports':
          await this.renderReports();
          break;
        case 'settings':
          await this.renderSettings();
          break;
        default:
          main.innerHTML = '<div class="pad center muted">Página no encontrada</div>';
      }
    } catch (error) {
      console.error('Error rendering main content:', error);
      main.innerHTML = '<div class="pad center err">Error al cargar la página</div>';
    }
  }

  async renderPOS() {
    const main = Utils.$('#main');
    if (!main) return;

    const pos = this.stateManager.pos;
    const totals = await this.posLogic.calcTotals();
    this.currentTotals = totals;

    main.innerHTML = `
      <div class="grid">
        <div class="card">
          <h3>Catálogo</h3>
          <div class="pad">
            <div class="catalog" id="catalog"></div>
          </div>
        </div>
        
        <div>
          <div class="card">
            <h3>Ticket</h3>
            <div class="pad">
              <div class="ticket">
                <div id="ticketLines"></div>
                <div id="totals"></div>
              </div>
            </div>
          </div>
          
          <div class="card">
            <h3>Pago</h3>
            <div class="pad">
              <div class="paybox">
                <label>Método:</label>
                <div id="paymentMethods"></div>
              </div>
              <div class="footer">
                <button class="btn" onclick="closeTicket()">Cerrar Ticket</button>
                <button class="btn light" onclick="resetPOS()">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Render catalog
    UIComponents.renderCatalog(this.products, this.variants);
    
    // Render ticket lines
    this.renderTicketLines();
    
    // Render totals
    await this.renderTotals(totals);
    
    // Render payment methods
    await this.renderPaymentMethods(totals);
  }

  renderTicketLines() {
    const container = Utils.$('#ticketLines');
    if (!container) return;

    const pos = this.stateManager.pos;
    container.innerHTML = UIComponents.renderTicketLines(
      pos.lines,
      (index, updates) => this.posLogic.updateLine(index, updates),
      (index) => this.posLogic.removeLine(index)
    );
  }

  async renderTotals(precalcTotals = null) {
    const container = Utils.$('#totals');
    if (!container) return;

    const totals = precalcTotals || await this.posLogic.calcTotals();
    this.currentTotals = totals;
    container.innerHTML = UIComponents.renderTotals(totals);
  }

  async renderPaymentMethods(precalcTotals = null) {
    const container = Utils.$('#paymentMethods');
    if (!container) return;

    const totals = precalcTotals || await this.posLogic.calcTotals();
    this.currentTotals = totals;

    const methods = (this.paymentMethods && this.paymentMethods.length)
      ? [...this.paymentMethods]
      : ['Efectivo'];

    if (!this.paymentForm) {
      const total = Number(totals.total || 0);
      const half = Utils.to2(total / 2);
      this.paymentForm = {
        mode: 'single',
        singleMethod: methods[0] || '',
        singleAmount: total,
        mixMethod1: methods[0] || '',
        mixMethod2: methods[1] || methods[0] || '',
        mixAmount1: half,
        mixAmount2: Utils.to2(total - half)
      };
    }

    this.syncPaymentFormWithState(totals, methods);

    const payments = this.stateManager.pos.payments || [];
    const paid = payments.reduce((sum, pay) => sum + Number(pay.monto || 0), 0);
    const outstanding = Math.max(0, Number(((totals.total || 0) - paid).toFixed(2)));

    container.innerHTML = UIComponents.renderPaymentMethods({
      methods,
      mode: this.paymentForm.mode,
      singleMethod: this.paymentForm.singleMethod || methods[0] || '',
      singleAmount: this.paymentForm.singleAmount ?? totals.total,
      mixMethod1: this.paymentForm.mixMethod1 || methods[0] || '',
      mixMethod2: this.paymentForm.mixMethod2 || methods[1] || methods[0] || '',
      mixAmount1: this.paymentForm.mixAmount1 ?? ((totals.total || 0) / 2),
      mixAmount2: this.paymentForm.mixAmount2 ?? ((totals.total || 0) / 2),
      payments,
      total: totals.total || 0,
      paid,
      outstanding
    });

    this.attachPaymentEvents(totals, methods);
  }

  syncPaymentFormWithState(totals, methods) {
    if (!this.paymentForm) return;
    const payments = this.stateManager.pos.payments || [];

    if (payments.length === 0) {
      if (!this.paymentForm.singleMethod) this.paymentForm.singleMethod = methods[0] || '';
      if (!this.paymentForm.mixMethod1) this.paymentForm.mixMethod1 = methods[0] || '';
      if (!this.paymentForm.mixMethod2) this.paymentForm.mixMethod2 = methods[1] || methods[0] || '';
      if (this.paymentForm.singleAmount == null) this.paymentForm.singleAmount = totals.total || 0;
      if (this.paymentForm.mixAmount1 == null) {
        this.paymentForm.mixAmount1 = Utils.to2((totals.total || 0) / 2);
      }
      if (this.paymentForm.mixAmount2 == null) {
        this.paymentForm.mixAmount2 = Utils.to2((totals.total || 0) / 2);
      }
      return;
    }

    if (payments.length === 1) {
      this.paymentForm.mode = 'single';
      this.paymentForm.singleMethod = payments[0].metodo;
      this.paymentForm.singleAmount = payments[0].monto;
    } else {
      this.paymentForm.mode = 'mixed';
      this.paymentForm.mixMethod1 = payments[0].metodo;
      this.paymentForm.mixAmount1 = payments[0].monto;
      const second = payments[1] || {};
      this.paymentForm.mixMethod2 = second.metodo || this.paymentForm.mixMethod2 || methods[1] || methods[0] || '';
      this.paymentForm.mixAmount2 = second.monto ?? this.paymentForm.mixAmount2 ?? 0;
    }
  }

  attachPaymentEvents(totals, methods) {
    const container = Utils.$('#paymentMethods');
    if (!container) return;

    const typeSelect = container.querySelector('#paymentType');
    if (typeSelect) {
      typeSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'Mixto') {
          this.paymentForm.mode = 'mixed';
        } else {
          this.paymentForm.mode = 'single';
          this.paymentForm.singleMethod = val;
        }
        this.renderPaymentMethods(totals);
      });
    }

    const singleInput = container.querySelector('#singleAmount');
    if (singleInput) {
      singleInput.addEventListener('input', (e) => {
        this.paymentForm.singleAmount = this.parsePaymentNumber(e.target.value);
      });
    }

    const fillBtn = container.querySelector('#singleFill');
    if (fillBtn) {
      fillBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.paymentForm.singleAmount = Number(totals.total || 0);
        this.renderPaymentMethods(totals);
      });
    }

    const applySingle = container.querySelector('#applySingle');
    if (applySingle) {
      applySingle.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.applySinglePayment(totals);
      });
    }

    const mixMethod1 = container.querySelector('#mixMethod1');
    if (mixMethod1) {
      mixMethod1.value = this.paymentForm.mixMethod1 || methods[0] || '';
      mixMethod1.addEventListener('change', (e) => {
        this.paymentForm.mixMethod1 = e.target.value;
      });
    }

    const mixMethod2 = container.querySelector('#mixMethod2');
    if (mixMethod2) {
      mixMethod2.value = this.paymentForm.mixMethod2 || methods[1] || methods[0] || '';
      mixMethod2.addEventListener('change', (e) => {
        this.paymentForm.mixMethod2 = e.target.value;
      });
    }

    const mixAmount1 = container.querySelector('#mixAmount1');
    if (mixAmount1) {
      mixAmount1.addEventListener('input', (e) => {
        this.paymentForm.mixAmount1 = this.parsePaymentNumber(e.target.value);
      });
    }

    const mixAmount2 = container.querySelector('#mixAmount2');
    if (mixAmount2) {
      mixAmount2.addEventListener('input', (e) => {
        this.paymentForm.mixAmount2 = this.parsePaymentNumber(e.target.value);
      });
    }

    const splitBtn = container.querySelector('#splitEven');
    if (splitBtn) {
      splitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const total = Number(totals.total || 0);
        const half = Utils.to2(total / 2);
        this.paymentForm.mixAmount1 = half;
        this.paymentForm.mixAmount2 = Utils.to2(total - half);
        this.renderPaymentMethods(totals);
      });
    }

    const applyMixed = container.querySelector('#applyMixed');
    if (applyMixed) {
      applyMixed.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.applyMixedPayments(totals);
      });
    }

    const clearBtn = container.querySelector('#clearPayments');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.clearRegisteredPayments(totals);
      });
    }
  }

  parsePaymentNumber(value) {
    const num = parseFloat(value);
    return Number.isFinite(num) ? Number(num.toFixed(2)) : 0;
  }

  async applySinglePayment(totals) {
    const method = this.paymentForm.singleMethod || this.paymentMethods?.[0] || 'Efectivo';
    const amount = this.parsePaymentNumber(this.paymentForm.singleAmount);
    try {
      await this.posLogic.validatePayments(method, {single: amount});
      Utils.toast('Pago registrado', 'ok');
      await this.renderPaymentMethods(totals);
    } catch (error) {
      console.error('Error registrando pago', error);
      Utils.toast('No se pudo registrar el pago', 'err');
    }
  }

  async applyMixedPayments(totals) {
    const payload = {
      method1: this.paymentForm.mixMethod1 || this.paymentMethods?.[0] || 'Efectivo',
      method2: this.paymentForm.mixMethod2 || this.paymentMethods?.[1] || this.paymentMethods?.[0] || 'Efectivo',
      mix1: this.parsePaymentNumber(this.paymentForm.mixAmount1),
      mix2: this.parsePaymentNumber(this.paymentForm.mixAmount2)
    };

    try {
      await this.posLogic.validatePayments('Mixto', payload);
      Utils.toast('Pagos registrados', 'ok');
      await this.renderPaymentMethods(totals);
    } catch (error) {
      console.error('Error registrando pagos mixtos', error);
      Utils.toast('No se pudieron registrar los pagos', 'err');
    }
  }

  clearRegisteredPayments(totals) {
    this.stateManager.setPayments([]);
    if (this.paymentForm) {
      this.paymentForm.mode = 'single';
      this.paymentForm.singleAmount = totals.total || 0;
    }
    this.renderPaymentMethods(totals);
  }

  async renderOrders() {
    const main = Utils.$('#main');
    const orders = await this.database.getAll('pos_orders');
    
    main.innerHTML = `
      <div class="card">
        <h3>Órdenes</h3>
        <div class="pad">
          ${UIComponents.renderOrdersTable(orders)}
        </div>
      </div>
    `;
  }

  async renderCustomers() {
    const main = Utils.$('#main');
    main.innerHTML = `
      <div class="card">
        <h3>Clientes</h3>
        <div class="pad">
          <div class="muted">Módulo de clientes en desarrollo...</div>
        </div>
      </div>
    `;
  }

  async renderStylists() {
    const main = Utils.$('#main');
    main.innerHTML = `
      <div class="card">
        <h3>Estilistas / Cajeros</h3>
        <div class="pad">
          <div class="muted">Módulo de estilistas en desarrollo...</div>
        </div>
      </div>
    `;
  }

  async renderExpenses() {
    const main = Utils.$('#main');
    main.innerHTML = `
      <div class="card">
        <h3>Gastos</h3>
        <div class="pad">
          <div class="muted">Módulo de gastos en desarrollo...</div>
        </div>
      </div>
    `;
  }

  async renderPurchases() {
    const main = Utils.$('#main');
    main.innerHTML = `
      <div class="card">
        <h3>Compras</h3>
        <div class="pad">
          <div class="muted">Módulo de compras en desarrollo...</div>
        </div>
      </div>
    `;
  }

  async renderSuppliers() {
    const main = Utils.$('#main');
    main.innerHTML = `
      <div class="card">
        <h3>Proveedores</h3>
        <div class="pad">
          <div class="muted">Módulo de proveedores en desarrollo...</div>
        </div>
      </div>
    `;
  }

  async renderPayroll() {
    const main = Utils.$('#main');
    main.innerHTML = `
      <div class="card">
        <h3>Nómina</h3>
        <div class="pad">
          <div class="muted">Módulo de nómina en desarrollo...</div>
        </div>
      </div>
    `;
  }

  async renderReports() {
    const main = Utils.$('#main');
    main.innerHTML = `
      <div class="card">
        <h3>Reportes</h3>
        <div class="pad">
          <div class="muted">Módulo de reportes en desarrollo...</div>
        </div>
      </div>
    `;
  }

  async renderSettings() {
    const main = Utils.$('#main');
    main.innerHTML = `
      <div class="card">
        <h3>Ajustes / Respaldo</h3>
        <div class="pad">
          <div class="muted">Módulo de ajustes en desarrollo...</div>
        </div>
      </div>
    `;
  }

  async closeTicket() {
    try {
      UIComponents.showLoading('Cerrando ticket...');
      
      // Take snapshot before closing
      this.posLogic.snapshotTicketLines();
      
      const order = await this.posLogic.closeTicket();
      
      Utils.toast('Ticket cerrado exitosamente', 'ok');
      this.posLogic.resetPOS();
      this.paymentForm = null;
      
      await this.renderPOS();
    } catch (error) {
      console.error('Error closing ticket:', error);
      Utils.toast('Error al cerrar ticket: ' + error.message, 'err');
    } finally {
      UIComponents.hideLoading();
    }
  }

  resetPOS() {
    this.posLogic.resetPOS();
    this.paymentForm = null;
    this.renderPOS();
  }

  async saveCurrentState() {
    try {
      // Save current POS state to localStorage for recovery
      const posState = this.stateManager.pos;
      localStorage.setItem('posState', JSON.stringify(posState));
    } catch (error) {
      console.warn('Error saving state:', error);
    }
  }

  async printCurrentTicket() {
    try {
      this.posLogic.snapshotTicketLines();
      // TODO: Implement printing functionality
      Utils.toast('Función de impresión en desarrollo...', 'warn');
    } catch (error) {
      console.error('Error printing ticket:', error);
      Utils.toast('Error al imprimir ticket', 'err');
    }
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  const app = new SalonPOSApp();
  window.app = app;
  await app.init();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SalonPOSApp;
} else {
  window.SalonPOSApp = SalonPOSApp;
}
