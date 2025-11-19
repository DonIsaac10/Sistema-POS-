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
    this.customers = [];
    this.stylists = [];
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
      await this.reloadCustomers();
      await this.reloadStylists();
      
      // Load payment methods from settings
      this.paymentMethods = (this.settings && this.settings.payment_methods) || ['Efectivo', 'Tarjeta', 'Transferencia'];
    } catch (error) {
      console.error('Error loading initial data:', error);
      throw error;
    }
  }

  async reloadCustomers() {
    const list = await this.database.getAll('customers');
    list.sort((a, b) => {
      const an = ((a && a.nombre) || '').toString().toLowerCase();
      const bn = ((b && b.nombre) || '').toString().toLowerCase();
      return an.localeCompare(bn, 'es', {sensitivity: 'base'});
    });
    this.customers = list;
    return this.customers;
  }

  async reloadStylists() {
    const list = await this.database.getAll('stylists');
    list.sort((a, b) => {
      const an = ((a && a.nombre) || '').toString().toLowerCase();
      const bn = ((b && b.nombre) || '').toString().toLowerCase();
      return an.localeCompare(bn, 'es', {sensitivity: 'base'});
    });
    this.stylists = list;
    return this.stylists;
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
          const clone = stylists.slice();
          const pctValue = stylist.pct != null
            ? Number(stylist.pct)
            : (stylist.porcentaje != null ? Number(stylist.porcentaje) : 0);
          clone.push({
            id: stylist.id,
            nombre: stylist.nombre,
            pct: pctValue
          });
          pos.stylistsGlobal = Utils.autoBalance(clone);
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

    window.newCustomer = () => this.openCustomerForm();
    window.editCustomer = (customerId) => this.openCustomerForm(customerId);
    window.deleteCustomer = (customerId) => this.removeCustomer(customerId);

    window.newStylist = () => this.openStylistForm();
    window.editStylist = (stylistId) => this.openStylistForm(stylistId);
    window.deleteStylist = (stylistId) => this.removeStylist(stylistId);

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
    const salonName = (this.settings && this.settings.salon) || 'The beauty sal\u00f3n by alan';
    const firma = (this.settings && this.settings.firma) || 'contacto@gammaconsultores.mx';
    UIComponents.renderHeader(salonName, firma);
  }

  renderFooter() {
    const firma = (this.settings && this.settings.firma) || 'contacto@gammaconsultores.mx';
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
          main.innerHTML = '<div class="pad center muted">P\u00e1gina no encontrada</div>';
      }
    } catch (error) {
      console.error('Error rendering main content:', error);
      main.innerHTML = '<div class="pad center err">Error al cargar la p\u00e1gina</div>';
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
          <h3>Cat\u00e1logo</h3>
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
                <label>M\u00e9todo:</label>
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
      ? this.paymentMethods.slice()
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
      singleAmount: (this.paymentForm.singleAmount != null ? this.paymentForm.singleAmount : totals.total),
      mixMethod1: this.paymentForm.mixMethod1 || methods[0] || '',
      mixMethod2: this.paymentForm.mixMethod2 || methods[1] || methods[0] || '',
      mixAmount1: (this.paymentForm.mixAmount1 != null ? this.paymentForm.mixAmount1 : ((totals.total || 0) / 2)),
      mixAmount2: (this.paymentForm.mixAmount2 != null ? this.paymentForm.mixAmount2 : ((totals.total || 0) / 2)),
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
      this.paymentForm.mixAmount2 = (second.monto != null ? second.monto : (this.paymentForm.mixAmount2 != null ? this.paymentForm.mixAmount2 : 0));
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
    const method = this.paymentForm.singleMethod || (this.paymentMethods && this.paymentMethods[0]) || 'Efectivo';
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
      method1: this.paymentForm.mixMethod1 || (this.paymentMethods && this.paymentMethods[0]) || 'Efectivo',
      method2: this.paymentForm.mixMethod2 || (this.paymentMethods && this.paymentMethods[1]) || (this.paymentMethods && this.paymentMethods[0]) || 'Efectivo',
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
        <h3>\u00d3rdenes</h3>
        <div class="pad">
          ${UIComponents.renderOrdersTable(orders)}
        </div>
      </div>
    `;
  }

  async renderCustomers() {
    const main = Utils.$('#main');
    if (!main) return;

    await this.reloadCustomers();
    const rows = this.customers.length ? this.customers.map(customer => {
      const points = this.safeValue(Number(customer.puntos || 0).toLocaleString('es-MX'));
      const phone = customer.celular ? this.safeValue(customer.celular) : null;
      const email = customer.correo ? `<div class="small muted">${this.safeValue(customer.correo)}</div>` : '';
      const notes = customer.notas ? `<div class="small muted">${this.safeValue(customer.notas)}</div>` : '';
      return `
        <tr>
          <td>
            <strong>${this.safeValue(customer.nombre || 'Sin nombre')}</strong>
            ${email}
            ${notes}
          </td>
          <td>${phone || '<span class="muted small">Sin tel\u00E9fono</span>'}</td>
          <td>${points}</td>
          <td>
            <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end">
              <button class="btn tiny light" onclick="editCustomer('${customer.id}')">Editar</button>
              <button class="btn tiny err" onclick="deleteCustomer('${customer.id}')">Eliminar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') : `
      <tr>
        <td colspan="4" class="center muted">A\u00FAn no hay clientes registrados</td>
      </tr>
    `;

    main.innerHTML = `
      <div class="card">
        <div class="pad" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div>
            <h3>Clientes</h3>
            <div class="muted small">${this.customers.length} registro${this.customers.length === 1 ? '' : 's'}</div>
          </div>
          <button class="btn" onclick="newCustomer()">Agregar cliente</button>
        </div>
        <div class="pad">
          <table class="table small">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Tel\u00E9fono</th>
                <th>Puntos</th>
                <th class="right">Acciones</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderStylists() {
    const main = Utils.$('#main');
    if (!main) return;

    await this.reloadStylists();
    const rows = this.stylists.length ? this.stylists.map(stylist => {
      const pct = this.safeValue(Number((stylist.pct != null ? stylist.pct : (stylist.porcentaje != null ? stylist.porcentaje : 0))).toFixed(1));
      const phone = stylist.celular ? this.safeValue(stylist.celular) : null;
      const role = this.safeValue(stylist.rol || 'Estilista');
      return `
        <tr>
          <td>
            <strong>${this.safeValue(stylist.nombre || 'Sin nombre')}</strong>
            <div class="small muted">${role}</div>
          </td>
          <td>${phone || '<span class="muted small">Sin tel\u00E9fono</span>'}</td>
          <td>${pct}%</td>
          <td>
            <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end">
              <button class="btn tiny light" onclick="editStylist('${stylist.id}')">Editar</button>
              <button class="btn tiny err" onclick="deleteStylist('${stylist.id}')">Eliminar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') : `
      <tr>
        <td colspan="4" class="center muted">A\u00FAn no hay estilistas registrados</td>
      </tr>
    `;

    main.innerHTML = `
      <div class="card">
        <div class="pad" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div>
            <h3>Estilistas / Cajeros</h3>
            <div class="muted small">${this.stylists.length} registro${this.stylists.length === 1 ? '' : 's'}</div>
          </div>
          <button class="btn" onclick="newStylist()">Agregar estilista</button>
        </div>
        <div class="pad">
          <table class="table small">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tel\u00E9fono</th>
                <th>% Comisi\u00F3n</th>
                <th class="right">Acciones</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  openCustomerForm(customerId = null) {
    const customer = customerId ? this.customers.find(c => c.id === customerId) : null;
    Utils.showModal(customer ? 'Editar cliente' : 'Nuevo cliente', `
      <div class="row">
        <div>
          <label>Nombre completo</label>
          <input type="text" id="customerName" placeholder="Nombre y apellido" value="${this.safeValue(customer && customer.nombre)}">
        </div>
        <div>
          <label>Tel\u00E9fono / celular</label>
          <input type="tel" id="customerPhone" placeholder="5551234567" value="${this.safeValue(customer && customer.celular)}">
        </div>
      </div>
      <div class="row" style="margin-top:8px">
        <div>
          <label>Correo</label>
          <input type="email" id="customerEmail" placeholder="correo@dominio.com" value="${this.safeValue(customer && customer.correo)}">
        </div>
        <div>
          <label>Puntos disponibles</label>
          <input type="number" id="customerPoints" min="0" step="1" value="${this.safeValue((customer && customer.puntos) != null ? customer.puntos : 0)}">
        </div>
      </div>
      <div style="margin-top:8px">
        <label>Notas</label>
        <textarea id="customerNotes" rows="3">${this.safeValue(customer && customer.notas)}</textarea>
      </div>
    `, {
      okText: 'Guardar',
      onOk: () => this.handleCustomerFormSubmit((customer && customer.id))
    });

    setTimeout(() => {
      const input = Utils.$('#customerName');
      if (input) input.focus();
    }, 50);
  }

  async handleCustomerFormSubmit(customerId) {
    const nameEl = Utils.$('#customerName');
    const phoneEl = Utils.$('#customerPhone');
    const emailEl = Utils.$('#customerEmail');
    const pointsEl = Utils.$('#customerPoints');
    const notesEl = Utils.$('#customerNotes');

    const nombre = Utils.cleanTxt((nameEl ? nameEl.value : '') || '');
    if (!nombre) {
      Utils.toast('El nombre es obligatorio', 'warn');
      return false;
    }

    const puntos = Math.max(0, Number((pointsEl ? pointsEl.value : '') || 0));
    const record = {
      id: customerId || undefined,
      nombre,
      celular: Utils.cleanTxt((phoneEl ? phoneEl.value : '') || ''),
      correo: Utils.cleanTxt((emailEl ? emailEl.value : '') || ''),
      puntos,
      notas: Utils.cleanTxt((notesEl ? notesEl.value : '') || '')
    };

    try {
      await this.database.put('customers', record);
      await this.reloadCustomers();
      const saved = this.customers.find(c => c.id === record.id) || record;
      if (this.stateManager.pos.customer && this.stateManager.pos.customer.id === saved.id) {
        this.stateManager.setCustomer(saved);
      }
      if (this.stateManager.activeTab === 'customers') {
        await this.renderCustomers();
      }
      Utils.toast('Cliente guardado', 'ok');
      return true;
    } catch (error) {
      console.error('Error saving customer', error);
      Utils.toast('No se pudo guardar el cliente', 'err');
      return false;
    }
  }

  async removeCustomer(customerId) {
    if (!customerId) return;
    const customer = this.customers.find(c => c.id === customerId);
    if (!customer) return;
    const proceed = window.confirm(`\u00BFEliminar al cliente "${customer.nombre || 'Sin nombre'}"?`);
    if (!proceed) return;

    try {
      await this.database.delete('customers', customerId);
      await this.reloadCustomers();
      if (this.stateManager.pos.customer && this.stateManager.pos.customer.id === customerId) {
        this.stateManager.setCustomer(null);
      }
      if (this.stateManager.activeTab === 'customers') {
        await this.renderCustomers();
      }
      Utils.toast('Cliente eliminado', 'warn');
    } catch (error) {
      console.error('Error deleting customer', error);
      Utils.toast('No se pudo eliminar el cliente', 'err');
    }
  }

  openStylistForm(stylistId = null) {
    const stylist = stylistId ? this.stylists.find(s => s.id === stylistId) : null;
    Utils.showModal(stylist ? 'Editar estilista' : 'Nuevo estilista', `
      <div class="row">
        <div>
          <label>Nombre</label>
          <input type="text" id="stylistName" placeholder="Nombre del estilista" value="${this.safeValue(stylist && stylist.nombre)}">
        </div>
        <div>
          <label>Rol</label>
          <input type="text" id="stylistRole" placeholder="Estilista, cajero, etc." value="${this.safeValue(stylist && stylist.rol)}">
        </div>
      </div>
      <div class="row" style="margin-top:8px">
        <div>
          <label>Tel\u00E9fono</label>
          <input type="tel" id="stylistPhone" placeholder="5551234567" value="${this.safeValue(stylist && stylist.celular)}">
        </div>
        <div>
          <label>% Comisi\u00F3n</label>
          <input type="number" id="stylistPct" min="0" max="100" step="0.5" value="${this.safeValue((stylist && stylist.pct) != null ? stylist.pct : (stylist && stylist.porcentaje) != null ? stylist.porcentaje : 0)}">
        </div>
      </div>
    `, {
      okText: 'Guardar',
      onOk: () => this.handleStylistFormSubmit((stylist && stylist.id))
    });

    setTimeout(() => {
      const input = Utils.$('#stylistName');
      if (input) input.focus();
    }, 50);
  }

  async handleStylistFormSubmit(stylistId) {
    const nameEl = Utils.$('#stylistName');
    const roleEl = Utils.$('#stylistRole');
    const phoneEl = Utils.$('#stylistPhone');
    const pctEl = Utils.$('#stylistPct');

    const nombre = Utils.cleanTxt((nameEl ? nameEl.value : '') || '');
    if (!nombre) {
      Utils.toast('El nombre es obligatorio', 'warn');
      return false;
    }

    const pct = Utils.clamp(Number((pctEl ? pctEl.value : '') || 0), 0, 100);
    const record = {
      id: stylistId || undefined,
      nombre,
      rol: Utils.cleanTxt((roleEl ? roleEl.value : '') || ''),
      celular: Utils.cleanTxt((phoneEl ? phoneEl.value : '') || ''),
      pct
    };

    try {
      await this.database.put('stylists', record);
      await this.reloadStylists();
      this.syncPosStylistsFromMaster();
      if (this.stateManager.activeTab === 'stylists') {
        await this.renderStylists();
      }
      if (this.stateManager.activeTab === 'pos') {
        await this.renderPOS();
      }
      Utils.toast('Estilista guardado', 'ok');
      return true;
    } catch (error) {
      console.error('Error saving stylist', error);
      Utils.toast('No se pudo guardar el estilista', 'err');
      return false;
    }
  }

  async removeStylist(stylistId) {
    if (!stylistId) return;
    const stylist = this.stylists.find(s => s.id === stylistId);
    if (!stylist) return;
    const proceed = window.confirm(`\u00BFEliminar a "${stylist.nombre || 'Sin nombre'}"?`);
    if (!proceed) return;

    try {
      await this.database.delete('stylists', stylistId);
      await this.reloadStylists();
      this.syncPosStylistsFromMaster();
      if (this.stateManager.activeTab === 'stylists') {
        await this.renderStylists();
      }
      if (this.stateManager.activeTab === 'pos') {
        await this.renderPOS();
      }
      Utils.toast('Estilista eliminado', 'warn');
    } catch (error) {
      console.error('Error deleting stylist', error);
      Utils.toast('No se pudo eliminar el estilista', 'err');
    }
  }

  syncPosStylistsFromMaster() {
    const pos = this.stateManager.pos;
    const map = new Map(this.stylists.map(s => [s.id, s]));

    if (Array.isArray(pos.stylistsGlobal)) {
      const synced = pos.stylistsGlobal
        .map(sel => {
          const ref = map.get(sel.id);
          if (!ref) return null;
          const pctValue = ref.pct != null
            ? ref.pct
            : (ref.porcentaje != null ? ref.porcentaje : (sel.pct != null ? sel.pct : 0));
          return Object.assign({}, sel, {
            nombre: ref.nombre,
            pct: Number(pctValue)
          });
        })
        .filter(Boolean);
      this.stateManager.setStylistsGlobal(synced);
    }

    if (Array.isArray(pos.lines) && pos.lines.length) {
      let changed = false;
      const updatedLines = pos.lines.map(line => {
        if (!Array.isArray(line.stylists) || !line.stylists.length) return line;
        const updatedStylists = line.stylists
          .map(sel => {
            const ref = map.get(sel.id);
            if (!ref) return null;
            return Object.assign({}, sel, {nombre: ref.nombre});
          })
          .filter(Boolean);
        if (updatedStylists.length !== line.stylists.length) {
          changed = true;
          return Object.assign({}, line, {stylists: updatedStylists});
        }
        return line;
      });

      if (changed) {
        this.stateManager.state.pos.lines = updatedLines;
        this.stateManager.notify('linesChanged', updatedLines);
      }
    }
  }
  async renderExpenses() {
    const main = Utils.$('#main');
    main.innerHTML = `
      <div class="card">
        <h3>Gastos</h3>
        <div class="pad">
          <div class="muted">M\u00f3dulo de gastos en desarrollo...</div>
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
          <div class="muted">M\u00f3dulo de compras en desarrollo...</div>
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
          <div class="muted">M\u00f3dulo de proveedores en desarrollo...</div>
        </div>
      </div>
    `;
  }

  async renderPayroll() {
    const main = Utils.$('#main');
    main.innerHTML = `
      <div class="card">
        <h3>N\u00f3mina</h3>
        <div class="pad">
          <div class="muted">M\u00f3dulo de n\u00f3mina en desarrollo...</div>
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
          <div class="muted">M\u00f3dulo de reportes en desarrollo...</div>
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
          <div class="muted">M\u00f3dulo de ajustes en desarrollo...</div>
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
      Utils.toast('Funci\u00f3n de impresi\u00f3n en desarrollo...', 'warn');
    } catch (error) {
      console.error('Error printing ticket:', error);
      Utils.toast('Error al imprimir ticket', 'err');
    }
  }

  safeValue(value) {
    const str = value == null ? '' : String(value);
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new SalonPOSApp();
  window.app = app;
  app.init();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SalonPOSApp;
} else {
  window.SalonPOSApp = SalonPOSApp;
}



