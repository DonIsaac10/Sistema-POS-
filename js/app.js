// Main application entry point

class SalonPOSApp {
  constructor() {
    this.database = null;
    this.posLogic = null;
    this.stateManager = window.stateManager;
    this.initialized = false;
  }

  async init() {
    try {
      UIComponents.showLoading('Iniciando sistema...');
      
      // Initialize database
      this.database = new Database();
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
      this.posLogic.addVariant(variantId);
      await this.renderPOS();
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
    this.stateManager.on('linesChanged', () => {
      if (this.stateManager.activeTab === 'pos') {
        this.renderTicketLines();
        this.renderTotals();
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
    this.renderTotals();
    
    // Render payment methods
    this.renderPaymentMethods();
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

  async renderTotals() {
    const container = Utils.$('#totals');
    if (!container) return;

    const totals = await this.posLogic.calcTotals();
    container.innerHTML = UIComponents.renderTotals(totals);
  }

  renderPaymentMethods() {
    const container = Utils.$('#paymentMethods');
    if (!container) return;

    container.innerHTML = UIComponents.renderPaymentMethods(
      this.paymentMethods,
      'Efectivo',
      (method) => console.log('Payment method changed:', method)
    );
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
