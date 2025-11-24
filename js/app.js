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
    this.orderFilters = {from: null, to: null, search: ''};
    this.reportFilters = {from: null, to: null, search: '', preset: '30'};
    this.customerSearchResults = [];
    this.expenseFilters = {from: null, to: null, category: '', status: 'all', search: ''};
    this.purchaseFilters = {from: null, to: null, supplier: '', status: 'all', search: ''};
  }

  // Nueva n�mina: calcula base + comisiones + propinas por periodo y permite registrar pagos pendientes/pagados
  async renderPayroll2() {
    const main = Utils.$('#main');
    if (!main) return;

    const filters = this.payrollFilters || {};
    const from = filters.from ? new Date(filters.from + 'T00:00:00') : null;
    const to = filters.to ? new Date(filters.to + 'T23:59:59') : null;
    const stylistId = filters.stylist || '';
    const statusFilter = filters.status || 'all';
    const q = (filters.search || '').toLowerCase();

    const entries = await this.database.getAll('payroll');
    const orders = await this.database.getAll('pos_orders');
    const lines = await this.database.getAll('pos_lines');
    const tips = await this.database.getAll('pos_tips');
    const stylistMap = new Map(this.stylists.map(s => [s.id, s]));
    const orderDates = new Map((orders || []).map(o => [o.id, o.fecha_hora || o.fecha || '']));
    const commissionCap = Number((this.settings && this.settings.commission_cap) || 20);
    // Frecuencias configurables
    const baseFreq = (this.settings && this.settings.payroll_base_freq) || 'quincenal'; // semanal | quincenal | mensual
    const commFreq = (this.settings && this.settings.payroll_comm_freq) || 'semanal'; // semanal | quincenal | mensual
    const tipFreq = (this.settings && this.settings.payroll_tip_freq) || 'semanal';

    const inRange = (dateStr) => {
      const d = new Date(dateStr || Date.now());
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    };

    const match = (row) => {
      const date = new Date(row.fecha_hora || row.fecha || row.created_at || Date.now());
      if (from && date < from) return false;
      if (to && date > to) return false;
      if (stylistId && row.stylist_id !== stylistId) return false;
      if (statusFilter !== 'all') {
        const st = (row.status || 'pendiente').toLowerCase();
        if (st !== statusFilter) return false;
      }
      if (q) {
        const txt = `${row.concepto || ''} ${row.notas || ''} ${row.metodo || ''}`.toLowerCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    };

    const filteredEntries = (entries || []).filter(match).sort((a, b) => {
      const ad = new Date(a.fecha_hora || a.fecha || a.created_at || 0).getTime();
      const bd = new Date(b.fecha_hora || b.fecha || b.created_at || 0).getTime();
      return bd - ad;
    });

    const totalPagado = filteredEntries.reduce((s, r) => s + (r.status === 'pagado' ? Number(r.commission || r.monto || r.amount || 0) : 0), 0);
    const totalPendiente = filteredEntries.reduce((s, r) => s + (r.status === 'pagado' ? 0 : Number(r.commission || r.monto || r.amount || 0)), 0);

    const optionsStylists = [`<option value="">Todos los estilistas</option>`]
      .concat(this.stylists.map(s => `<option value="${s.id}" ${s.id === stylistId ? 'selected' : ''}>${this.safeValue(s.nombre || '')}</option>`))
      .join('');

    const paymentOpts = (this.paymentMethods || ['Efectivo','Tarjeta','Transferencia'])
      .map(m => `<option value="${this.safeValue(m)}">${this.safeValue(m)}</option>`).join('');

    const freqFactor = (freq, days) => {
      if (freq === 'semanal') return 7 / days;       // ajusta base semanal al rango
      if (freq === 'quincenal') return 15 / days;    // ajusta base quincenal al rango
      if (freq === 'mensual') return 30 / days;      // aproximado
      return 1;
    };

    const rangeDays = (() => {
      if (!from || !to) return 1;
      return Math.max(1, Math.round((to - from) / (1000 * 60 * 60 * 24)) + 1);
    })();

    const payables = this.stylists.map(st => {
      const baseFull = Number(st.base_salary || 0);
      // prorrateo de base seg�n frecuencia y rango
      let base = baseFull;
      if (rangeDays > 0) {
        if (baseFreq === 'semanal') base = baseFull * Math.min(1, rangeDays / 7);
        if (baseFreq === 'quincenal') base = baseFull * Math.min(1, rangeDays / 15);
        if (baseFreq === 'mensual') base = baseFull * Math.min(1, rangeDays / 30);
      }
      let comm = 0;
      let tipSum = 0;

      (lines || []).forEach(line => {
        if (!Array.isArray(line.stylists)) return;
        const od = orderDates.get(line.order_id);
        if (!od || !inRange(od)) return;
        if (!line.lineTotal) return;
        // s�lo contar comisiones si coincide frecuencia (si se quisiera filtrar por semana vs quincena, se usa el rango ya)
        line.stylists.forEach(ls => {
          if (ls.id === st.id) {
            const pct = Math.min(Number(ls.pct || 0), commissionCap);
            comm += Number(line.lineTotal || 0) * (pct / 100);
          }
        });
      });

      (tips || []).forEach(t => {
        if (t.stylist_id !== st.id) return;
        const td = t.fecha_hora || t.fecha;
        if (!inRange(td)) return;
        tipSum += Number(t.monto || 0);
      });

      const paid = (entries || []).reduce((sum, r) => {
        const date = r.fecha_hora || r.fecha || r.created_at;
        if (!inRange(date)) return sum;
        if (r.stylist_id !== st.id) return sum;
        if ((r.status || 'pendiente') !== 'pagado') return sum;
        return sum + Number(r.commission || r.monto || r.amount || 0);
      }, 0);

      const total = base + comm + tipSum;
      const pending = Math.max(0, total - paid);
      return {id: st.id, nombre: st.nombre, base, comm, tipSum, total, paid, pending};
    }).filter(p => !stylistId || p.id === stylistId);

    const summaryHTML = payables.map(p => `
      <tr data-sty="${p.id}">
        <td>${this.safeValue(p.nombre || '')}</td>
        <td class="right">${Utils.money(p.base)}</td>
        <td class="right">${Utils.money(p.comm)}</td>
        <td class="right">${Utils.money(p.tipSum)}</td>
        <td class="right"><b>${Utils.money(p.total)}</b></td>
        <td class="right">${Utils.money(p.paid)}</td>
        <td class="right">${Utils.money(p.pending)}</td>
        <td class="right">
          ${p.pending > 0 ? `<button class="btn tiny" data-action="pay-pending" data-id="${p.id}">Registrar pendiente</button>` : ''}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="8" class="center muted">Sin estilistas en el rango</td>';

    const rowsHTML = filteredEntries.map(row => {
      const amt = Number(row.commission || row.monto || row.amount || 0);
      const status = (row.status || 'pendiente').toLowerCase();
      const sty = stylistMap.get(row.stylist_id);
      const styName = this.safeValue(row.stylist_nombre || (sty && sty.nombre) || 'N/D');
      const date = (row.fecha_hora || row.fecha || row.created_at || '').slice(0, 10);
      const method = this.safeValue(row.metodo || row.method || 'N/D');
      const concept = this.safeValue(row.concepto || 'Pago n�mina');
      const note = this.safeValue(row.notas || '');
      return `
        <tr data-id="${row.id}">
          <td>${date}</td>
          <td>${styName}</td>
          <td>${concept}</td>
          <td class="right">${Utils.money(amt)}</td>
          <td>${status === 'pagado' ? '<span class="ok">Pagado</span>' : '<span class="warn">Pendiente</span>'}</td>
          <td>${method}</td>
          <td>${note}</td>
          <td class="right">
            ${status !== 'pagado' ? `<button class="btn tiny" data-action="pay">Marcar pagado</button>` : ''}
            <button class="btn tiny err" data-action="del">&times;</button>
          </td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="8" class="center muted">Sin registros</td>';

    main.innerHTML = `
      <div class="card">
        <h3>N�mina</h3>
        <div class="pad stack">
          <div class="row" style="flex-wrap:wrap; gap:8px">
            <div>
              <label>Del</label>
              <input type="date" id="payrollFrom" value="${filters.from || ''}">
            </div>
            <div>
              <label>Al</label>
              <input type="date" id="payrollTo" value="${filters.to || ''}">
            </div>
            <div>
              <label>Estilista</label>
              <select id="payrollStylistFilter">${optionsStylists}</select>
            </div>
            <div>
              <label>Estado</label>
              <select id="payrollStatus">
                <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>Todos</option>
                <option value="pendiente" ${statusFilter === 'pendiente' ? 'selected' : ''}>Pendiente</option>
                <option value="pagado" ${statusFilter === 'pagado' ? 'selected' : ''}>Pagado</option>
              </select>
            </div>
            <div style="flex:1; min-width:180px">
              <label>Buscar</label>
              <input type="text" id="payrollSearch" placeholder="Concepto, notas, m�todo" value="${filters.search || ''}">
            </div>
            <button class="btn" id="payrollApply">Filtrar</button>
          </div>

          <div class="card" style="background:#f9fbfb">
            <h4>Resumen por estilista (base + comisiones + propinas)</h4>
            <div style="overflow:auto">
              <table class="table">
                <thead>
                  <tr>
                    <th>Estilista</th>
                    <th class="right">Base</th>
                    <th class="right">Comisiones</th>
                    <th class="right">Propinas</th>
                    <th class="right">Total generado</th>
                    <th class="right">Pagado</th>
                    <th class="right">Pendiente</th>
                    <th class="right">Acciones</th>
                  </tr>
                </thead>
                <tbody>${summaryHTML}</tbody>
              </table>
            </div>
          </div>

          <div class="row" style="gap:16px; flex-wrap:wrap">
            <div class="pill">Pendiente (pagos registrados): <strong>${Utils.money(totalPendiente)}</strong></div>
            <div class="pill ok">Pagado (pagos registrados): <strong>${Utils.money(totalPagado)}</strong></div>
            <div class="pill ok">Total registros: <strong>${Utils.money(totalPendiente + totalPagado)}</strong></div>
          </div>

          <div class="card muted" style="background:#f9fbfb">
            <div class="row" style="flex-wrap:wrap; gap:10px">
              <div>
                <label>Estilista</label>
                <select id="payrollStylist">${optionsStylists.replace('Todos los estilistas','Seleccione')}</select>
              </div>
              <div>
                <label>Fecha</label>
                <input type="date" id="payrollDate" value="${new Date().toISOString().slice(0,10)}">
              </div>
              <div>
                <label>Monto</label>
                <input type="number" id="payrollAmount" min="0" step="0.01" placeholder="0.00">
              </div>
              <div style="flex:1; min-width:200px">
                <label>Concepto</label>
                <input type="text" id="payrollConcept" placeholder="Pago n�mina / bono">
              </div>
              <div>
                <label>M�todo</label>
                <select id="payrollMethod">${paymentOpts}</select>
              </div>
              <div>
                <label>Estado</label>
                <select id="payrollStatusNew">
                  <option value="pagado">Pagado</option>
                  <option value="pendiente">Pendiente</option>
                </select>
              </div>
              <div style="flex:1; min-width:200px">
                <label>Notas</label>
                <input type="text" id="payrollNotes" placeholder="Referencia, folio, etc.">
              </div>
              <button class="btn" id="payrollAdd">Agregar</button>
            </div>
          </div>

          <div style="overflow:auto">
            <table class="table" id="payrollTable">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Estilista</th>
                  <th>Concepto</th>
                  <th class="right">Monto</th>
                  <th>Estado</th>
                  <th>M�todo</th>
                  <th>Notas</th>
                  <th class="right">Acciones</th>
                </tr>
              </thead>
              <tbody>${rowsHTML}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const applyFilters = () => {
      this.payrollFilters = {
        from: Utils.$('#payrollFrom').value || '',
        to: Utils.$('#payrollTo').value || '',
        stylist: Utils.$('#payrollStylistFilter').value || '',
        status: Utils.$('#payrollStatus').value || 'all',
        search: Utils.$('#payrollSearch').value || ''
      };
      this.renderPayroll2();
    };

    const applyBtn = Utils.$('#payrollApply');
    if (applyBtn) applyBtn.onclick = applyFilters;

    const addBtn = Utils.$('#payrollAdd');
    if (addBtn) {
      addBtn.onclick = async () => {
        try {
          const styId = Utils.$('#payrollStylist').value;
          const sty = stylistMap.get(styId);
          const styName = this.safeValue(sty ? sty.nombre : '');
          const fecha = Utils.$('#payrollDate').value || new Date().toISOString().slice(0,10);
          const amount = Number(Utils.$('#payrollAmount').value || 0);
          const concept = Utils.cleanTxt(Utils.$('#payrollConcept').value || 'N�mina');
          const method = Utils.$('#payrollMethod').value || 'Efectivo';
          const status = Utils.$('#payrollStatusNew').value || 'pagado';
          const notes = Utils.cleanTxt(Utils.$('#payrollNotes').value || '');

          if (!styId) {
            Utils.toast('Selecciona un estilista', 'warn');
            return;
          }
          if (amount <= 0) {
            Utils.toast('Monto inválido', 'warn');
            return;
          }

          await this.database.put('payroll', {
            id: Utils.uid(),
            stylist_id: styId,
            stylist_nombre: styName,
            fecha: fecha,
            fecha_hora: fecha + 'T00:00:00',
            commission: amount,
            concepto: concept,
            metodo: method,
            status,
            notas: notes,
            tipo: 'manual',
            created_at: Utils.nowISO()
          });

          Utils.toast('Registro agregado', 'ok');
          await this.renderPayroll2();
        } catch (error) {
          console.error('Agregar n�mina', error);
          Utils.toast('No se pudo agregar el registro', 'err');
        }
      };
    }

    const table = Utils.$('#payrollTable');
    if (table) {
      table.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-action]');
        if (!btn) return;
        const tr = btn.closest('tr[data-id]');
        const id = tr ? tr.getAttribute('data-id') : null;
        if (!id) return;
        if (btn.dataset.action === 'pay') {
          const rec = entries.find(r => r.id === id);
          if (!rec) return;
          rec.status = 'pagado';
          rec.paid_at = Utils.nowISO();
          await this.database.put('payroll', rec);
          Utils.toast('Marcado como pagado', 'ok');
          await this.renderPayroll2();
        } else if (btn.dataset.action === 'del') {
          if (!window.confirm('�Eliminar registro?')) return;
          await this.database.delete('payroll', id);
          Utils.toast('Registro eliminado', 'warn');
          await this.renderPayroll2();
        }
      });
    }

    const summaryTable = main.querySelector('.card table');
    if (summaryTable) {
      summaryTable.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-action="pay-pending"]');
        if (!btn) return;
        const id = btn.dataset.id;
        const pay = payables.find(p => p.id === id);
        if (!pay || pay.pending <= 0) return;
        const fecha = new Date().toISOString().slice(0,10);
        await this.database.put('payroll', {
          id: Utils.uid(),
          stylist_id: id,
          stylist_nombre: this.safeValue(stylistMap.get(id) ? stylistMap.get(id).nombre : ''),
          fecha,
          fecha_hora: fecha + 'T00:00:00',
          commission: pay.pending,
          concepto: 'N�mina periodo',
          metodo: 'Efectivo',
          status: 'pendiente',
          tipo: 'auto',
          notas: `Base+comisiones+propinas ${filters.from || ''} a ${filters.to || ''}`,
          created_at: Utils.nowISO()
        });
        Utils.toast('Pendiente registrado', 'ok');
        await this.renderPayroll2();
      });
    }
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
      } else {
        this.settings = {id: 'main'};
      }
      let settingsChanged = false;
      if (this.settings.loyalty_rate == null) {
        this.settings.loyalty_rate = 0.02;
        settingsChanged = true;
      }
      if (this.settings.iva_rate == null) {
        this.settings.iva_rate = 0.16;
        settingsChanged = true;
      }
      if (this.settings.commission_cap == null) {
        this.settings.commission_cap = 20;
        settingsChanged = true;
      }
      if (!this.settings.payroll_base_freq) {
        this.settings.payroll_base_freq = 'quincenal';
        settingsChanged = true;
      }
      if (!this.settings.payroll_comm_freq) {
        this.settings.payroll_comm_freq = 'semanal';
        settingsChanged = true;
      }
      if (!this.settings.payroll_tip_freq) {
        this.settings.payroll_tip_freq = 'semanal';
        settingsChanged = true;
      }
      if (!Array.isArray(this.settings.payment_methods) || this.settings.payment_methods.length === 0) {
        this.settings.payment_methods = ['Efectivo', 'Tarjeta', 'Transferencia'];
        settingsChanged = true;
      }
      if (settingsChanged) {
        await this.database.put('settings', this.settings);
      }
      UIComponents.commissionCap = Number(this.settings.commission_cap || 20);

      // Load initial data for POS
      this.products = await this.database.getAll('products');
      this.variants = await this.database.getAll('variants');
      await this.reloadCustomers();
      await this.reloadStylists();
      this.initOrderFilters();
      this.initReportFilters();
      
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

  initOrderFilters() {
    const today = new Date();
    const to = today.toISOString().slice(0, 10);
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 7);
    const from = fromDate.toISOString().slice(0, 10);
    this.orderFilters = {from, to, search: ''};
  }

  initReportFilters() {
    const today = new Date();
    const to = today.toISOString().slice(0, 10);
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 30);
    const from = fromDate.toISOString().slice(0, 10);
    this.reportFilters = {from, to, search: '', preset: '30'};
  }

  normalizeDateInput(value) {
    if (!value) return '';
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
    return '';
  }

  applyReportPreset(preset) {
    const today = new Date();
    let from = null;
    let to = today.toISOString().slice(0, 10);

    if (preset === '7') {
      const d = new Date(today);
      d.setDate(d.getDate() - 7);
      from = d.toISOString().slice(0, 10);
    } else if (preset === '30') {
      const d = new Date(today);
      d.setDate(d.getDate() - 30);
      from = d.toISOString().slice(0, 10);
    } else if (preset === 'ytd') {
      const d = new Date(today.getFullYear(), 0, 1);
      from = d.toISOString().slice(0, 10);
    } else if (preset === 'custom') {
      from = this.reportFilters && this.reportFilters.from || '';
      to = this.reportFilters && this.reportFilters.to || '';
    }

    this.reportFilters = Object.assign({}, this.reportFilters, {
      preset,
      from,
      to
    });
  }

  applyOrderFilters(orders) {
    const filters = this.orderFilters || {};
    const from = filters.from ? new Date(filters.from + 'T00:00:00') : null;
    const to = filters.to ? new Date(filters.to + 'T23:59:59') : null;
    const query = (filters.search || '').toLowerCase();

    return (orders || []).filter(order => {
      const date = new Date(order.fecha_hora || order.fecha || Date.now());
      if (from && date < from) return false;
      if (to && date > to) return false;
      if (query) {
        const folio = (order.folio || '').toLowerCase();
        const name = ((order.customer && order.customer.nombre) || 'cliente general').toLowerCase();
        if (!folio.includes(query) && !name.includes(query)) return false;
      }
      return true;
    }).sort((a, b) => {
      const ad = new Date(a.fecha_hora || 0).getTime();
      const bd = new Date(b.fecha_hora || 0).getTime();
      return bd - ad;
    });
  }

  async updateOrderFilters(patch) {
    this.orderFilters = Object.assign({}, this.orderFilters, patch);
    await this.renderOrders();
  }

  async resetOrderFilters() {
    this.initOrderFilters();
    await this.renderOrders();
  }

  async updateReportFilters(patch) {
    this.reportFilters = Object.assign({}, this.reportFilters, patch);
    await this.renderReports();
  }

  async resetReportFilters(preset = '30') {
    this.initReportFilters();
    this.reportFilters.preset = preset;
    await this.renderReports();
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
      this.openLineStylist(lineIndex);
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
      await this.openOrderDetail(orderId);
    };

    window.printOrder = async (orderId) => {
      await this.printOrderTicket(orderId);
    };

    window.closeTicket = async () => {
      await this.closeTicket();
    };

    window.resetPOS = () => {
      this.resetPOS();
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
    const salonName = 'The Beauty Salon by Alan';
    const rawFirma = (this.settings && this.settings.firma) || 'contacto@gammaconsultores.mx';
    const firma = rawFirma.replace(/programa desarrollado por\s*/i, '').trim() || 'contacto@gammaconsultores.mx';
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
          await this.renderPayroll2 ? await this.renderPayroll2() : await this.renderPayroll();
          break;
        case 'coupons':
          await this.renderCoupons();
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
    UIComponents.commissionCap = Number((this.settings && this.settings.commission_cap) || 20);
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
              <div id="posCustomer"></div>
              <div class="ticket" style="margin-top:12px">
                <div id="ticketLines"></div>
              </div>
            </div>
          </div>

          <div class="card" id="cardTips">
            <h3>Propina</h3>
            <div class="pad">
              <div id="posTips"></div>
            </div>
          </div>

          <div class="card" id="cardCoupon">
            <h3>Cup\u00f3n / Descuento</h3>
            <div class="pad">
              <div id="posCoupon"></div>
            </div>
          </div>

          <div class="card" id="cardTotals">
            <h3>Resumen</h3>
            <div class="pad">
              <div id="totals"></div>
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
    
    // Render customer / stylists / tips / coupon
    this.renderCustomerBox();
    this.renderTipsBox();
    this.renderCouponBox();
    
    // Render ticket lines
    this.renderTicketLines();
    
    // Render totals (separate card)
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

  renderCustomerBox() {
    const container = Utils.$('#posCustomer');
    if (!container) return;
    const pos = this.stateManager.pos;
    const cust = pos.customer;
    const pointsEarned = this.currentTotals ? this.currentTotals.pointsEarned : 0;
    const pointsAvailable = cust && cust.puntos ? Number(cust.puntos) : 0;

    const resultsHTML = (this.customerSearchResults || []).slice(0, 5).map(c => `
      <div class="chip" data-cust="${c.id}">
        <span>${this.safeValue(c.nombre || '')}</span>
        <b>${this.safeValue(c.celular || '')}</b>
      </div>
    `).join('') || '<div class="muted small">Busca por celular</div>';

    container.innerHTML = `
      <div class="card-lite">
        <div class="row" style="align-items:flex-end; gap:8px">
          <div style="flex:1">
            <label>Cliente (celular)</label>
            <input type="tel" id="custSearchPhone" placeholder="Ej. 5512345678">
          </div>
          <div style="flex:0 0 auto">
            <button class="btn light" id="custBtnSearch">Buscar</button>
          </div>
          <div style="flex:0 0 auto">
            <button class="btn light" id="custBtnClear">General</button>
          </div>
        </div>
        <div class="muted small" style="margin-top:6px">Resultados</div>
        <div id="custResults" class="chips">${resultsHTML}</div>
        <div style="margin-top:8px">
          <div class="label-aux">Cliente seleccionado</div>
          <div><strong>${cust ? this.safeValue(cust.nombre || '') : 'Cliente general'}</strong></div>
          <div class="muted small">Puntos: ${pointsAvailable}</div>
          <div class="muted small">Puntos a ganar: ${pointsEarned}</div>
        </div>
        <div style="margin-top:8px; display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap">
          <div>
            <label>Usar puntos</label>
            <input type="number" id="custPointsUse" min="0" step="1" value="${Number(pos.customerPointsUsed || 0)}">
          </div>
          <button class="btn light" id="custApplyPoints">Aplicar puntos</button>
        </div>
      </div>
    `;

    const btnSearch = Utils.$('#custBtnSearch');
    if (btnSearch) {
      btnSearch.onclick = () => this.searchCustomerByPhone();
    }
    const inputPhone = Utils.$('#custSearchPhone');
    if (inputPhone) {
      inputPhone.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.searchCustomerByPhone();
        }
      };
    }
    const results = Utils.$('#custResults');
    if (results) {
      results.onclick = (e) => {
        const target = e.target.closest('[data-cust]');
        if (!target) return;
        const id = target.getAttribute('data-cust');
        this.selectCustomerById(id);
      };
    }
    const btnClear = Utils.$('#custBtnClear');
    if (btnClear) {
      btnClear.onclick = () => {
        this.stateManager.setCustomer(null);
        this.stateManager.updatePos({customerPointsUsed: 0});
        this.renderPOS();
      };
    }
    const btnApply = Utils.$('#custApplyPoints');
    if (btnApply) {
      btnApply.onclick = () => {
        const val = Number(Utils.$('#custPointsUse').value || 0);
        this.posLogic.setCustomerPointsUsed(val);
        this.renderPOS();
      };
    }
  }

  async searchCustomerByPhone() {
    const phone = (Utils.$('#custSearchPhone') && Utils.$('#custSearchPhone').value) || '';
    const cleaned = phone.replace(/[^0-9]/g, '');
    if (!cleaned) {
      Utils.toast('Ingresa un celular', 'warn');
      return;
    }
    const list = await this.posLogic.searchCustomersByPhone(cleaned);
    this.customerSearchResults = list || [];
    this.renderCustomerBox();
  }

  async selectCustomerById(id) {
    await this.posLogic.setCustomer(id);
    this.renderPOS();
  }

  renderStylistsBox() {
    const container = Utils.$('#posStylists');
    if (!container) return;
    const pos = this.stateManager.pos;
    const selected = pos.stylistsGlobal || [];
    container.innerHTML = `
      <div class="card-lite">
        <div class="label-aux">Estilistas (por servicio)</div>
        <div class="muted small">Selecciona estilistas dentro de cada l\u00ednea (bot\u00f3n Editar). Si eliges aqu\u00ed, se usar\u00e1n como sugerencia al agregar nuevas l\u00edneas.</div>
        ${UIComponents.renderStylistSelector(this.stylists || [], selected)}
      </div>
    `;
  }

  renderTipsBox() {
    const container = Utils.$('#posTips');
    if (!container) return;
    const pos = this.stateManager.pos;
    // Estilistas elegibles: los asignados en las l\u00edneas; si no hay, usar los seleccionados globales; si tampoco, usar todos.
    const fromLines = (pos.lines || []).flatMap(l => l.stylists || []);
    const unique = [];
    const seen = new Set();
    fromLines.forEach(s => {
      if (s && !seen.has(s.id)) {
        unique.push(s);
        seen.add(s.id);
      }
    });
    let selectedStylists = unique;
    if (!selectedStylists.length && Array.isArray(pos.stylistsGlobal) && pos.stylistsGlobal.length) {
      selectedStylists = pos.stylistsGlobal;
    }
    if (!selectedStylists.length && Array.isArray(this.stylists)) {
      selectedStylists = this.stylists;
    }
    const alloc = pos.tipAlloc || [];
    const totalTip = alloc.reduce((s, t) => s + Number(t.monto || 0), 0);

    const rows = selectedStylists.length ? selectedStylists.map(st => {
      const found = alloc.find(t => t.stylist_id === st.id);
      const val = found ? Number(found.monto || 0) : 0;
      return `
        <div class="row" style="align-items:center">
          <div>${this.safeValue(st.nombre || '')}</div>
          <input type="number" data-tip="${st.id}" min="0" step="0.01" value="${val.toFixed(2)}">
        </div>
      `;
    }).join('') : '<div class="muted small">Selecciona estilistas (editar l\u00edneas) para asignar propina</div>';

    container.innerHTML = `
      <div class="card-lite">
        <div class="label-aux">Propina para estilistas</div>
        <div class="row" style="align-items:flex-end;gap:8px">
          <div>
            <label>Total propina</label>
            <input type="number" id="tipTotalInput" min="0" step="0.01" value="${totalTip.toFixed(2)}">
          </div>
          <button class="btn light" id="tipDistribute">Distribuir entre estilistas</button>
        </div>
        <div style="margin-top:8px" id="tipRows">
          ${rows}
        </div>
      </div>
    `;

    const btnDist = Utils.$('#tipDistribute');
    if (btnDist) {
      btnDist.onclick = () => this.distributeTips();
    }
    const tipRows = Utils.$('#tipRows');
    if (tipRows) {
      tipRows.oninput = (e) => {
        const target = e.target;
        if (target && target.getAttribute('data-tip')) {
          const id = target.getAttribute('data-tip');
          const val = Number(target.value || 0);
          this.posLogic.addTipAllocation(id, val);
          this.renderPOS();
        }
      };
    }
  }

  distributeTips() {
    const pos = this.stateManager.pos;
    const fromLines = (pos.lines || []).flatMap(l => l.stylists || []);
    const uniq = [];
    const seen = new Set();
    fromLines.forEach(s => {
      if (s && !seen.has(s.id)) {
        uniq.push(s);
        seen.add(s.id);
      }
    });
    let stylists = uniq;
    if (!stylists.length && Array.isArray(pos.stylistsGlobal)) {
      stylists = pos.stylistsGlobal;
    }
    const total = Number(Utils.$('#tipTotalInput') ? Utils.$('#tipTotalInput').value : 0) || 0;
    if (!stylists.length) {
      Utils.toast('Selecciona estilistas primero', 'warn');
      return;
    }
    const share = total / stylists.length;
    stylists.forEach(s => this.posLogic.addTipAllocation(s.id, share));
    this.renderPOS();
  }

  renderCouponBox() {
    const container = Utils.$('#posCoupon');
    if (!container) return;
    const pos = this.stateManager.pos;
    const current = pos.coupon || '';
    const globalDisc = pos.globalDiscount || 0;
    const globalDiscType = pos.globalDiscountType || 'amount';
    container.innerHTML = `
      <div class="card-lite">
        <div class="label-aux">Cupón / Descuento</div>
        <div class="row" style="align-items:flex-end; gap:8px">
          <div style="flex:1">
            <label>Código</label>
            <input type="text" id="couponCode" value="${this.safeValue(current)}" placeholder="Ej. PROMO10">
          </div>
          <button class="btn light" id="couponApply">Aplicar</button>
        </div>
        <div class="row" style="align-items:flex-end; gap:8px; margin-top:8px">
          <div style="flex:1">
            <label>Descuento global</label>
            <input type="number" id="globalDiscount" min="0" step="0.01" value="${Number(globalDisc || 0)}">
          </div>
          <div style="flex:0 0 auto">
            <label>&nbsp;</label>
            <select id="globalDiscountType">
              <option value="amount"${globalDiscType === 'amount' ? ' selected' : ''}>Monto</option>
              <option value="percent"${globalDiscType === 'percent' ? ' selected' : ''}>%</option>
            </select>
          </div>
          <button class="btn light" id="globalDiscountApply">Aplicar descuento</button>
        </div>
      </div>
    `;

    const btn = Utils.$('#couponApply');
    if (btn) {
      btn.onclick = async () => {
        const code = Utils.$('#couponCode') ? Utils.$('#couponCode').value : '';
        await this.posLogic.applyCoupon(code);
        this.renderPOS();
      };
    }

    const btnDisc = Utils.$('#globalDiscountApply');
    if (btnDisc) {
      btnDisc.onclick = () => {
        const val = Number(Utils.$('#globalDiscount') ? Utils.$('#globalDiscount').value : 0) || 0;
        const type = Utils.$('#globalDiscountType') ? Utils.$('#globalDiscountType').value : 'amount';
        this.stateManager.updatePos({globalDiscount: val, globalDiscountType: type});
        this.renderPOS();
      };
    }
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
    if (!main) return;

    const orders = await this.database.getAll('pos_orders');
    const filtered = this.applyOrderFilters(orders);
    const filters = this.orderFilters || {};

    const total = filtered.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const tips = filtered.reduce((sum, order) => sum + Number(order.tipTotal || 0), 0);
    const avg = filtered.length ? total / filtered.length : 0;

    const rows = filtered.length ? filtered.map(order => {
      const dateTxt = new Date(order.fecha_hora || order.fecha || Date.now()).toLocaleDateString('es-MX');
      const customerName = this.safeValue((order.customer && order.customer.nombre) || 'Cliente general');
      return `
        <tr>
          <td>${this.safeValue(order.folio || 'N/A')}</td>
          <td>${dateTxt}</td>
          <td>${customerName}</td>
          <td>${Utils.money(order.total || 0)}</td>
          <td>
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
              <button class="btn tiny" onclick="viewOrder('${order.id}')">Ver</button>
              <button class="btn tiny light" onclick="printOrder('${order.id}')">Imprimir</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') : `
      <tr>
        <td colspan="5" class="center muted">No se encontraron \u00f3rdenes con los filtros actuales</td>
      </tr>
    `;

    main.innerHTML = `
      <div class="card">
        <h3>\u00d3rdenes</h3>
        <div class="pad">
          <div class="row" style="gap:12px;flex-wrap:wrap">
            <div>
              <label>Del</label>
              <input type="date" id="ordersFrom" value="${this.safeValue(filters.from || '')}">
            </div>
            <div>
              <label>Al</label>
              <input type="date" id="ordersTo" value="${this.safeValue(filters.to || '')}">
            </div>
            <div style="flex:1;min-width:180px">
              <label>Buscar</label>
              <input type="text" id="ordersSearch" placeholder="Folio o cliente" value="${this.safeValue(filters.search || '')}">
            </div>
            <div style="display:flex;align-items:flex-end">
              <button class="btn light" id="ordersReset">Restablecer</button>
            </div>
          </div>

          <div class="row" style="margin-top:16px;gap:12px;flex-wrap:wrap">
            <div class="card-lite" style="flex:1;min-width:160px">
              <div class="label-aux">Total tickets</div>
              <div><strong>${filtered.length}</strong></div>
            </div>
            <div class="card-lite" style="flex:1;min-width:160px">
              <div class="label-aux">Ventas filtradas</div>
              <div><strong>${Utils.money(total)}</strong></div>
            </div>
            <div class="card-lite" style="flex:1;min-width:160px">
              <div class="label-aux">Promedio ticket</div>
              <div><strong>${Utils.money(avg)}</strong></div>
            </div>
            <div class="card-lite" style="flex:1;min-width:160px">
              <div class="label-aux">Propinas</div>
              <div><strong>${Utils.money(tips)}</strong></div>
            </div>
          </div>

          <div style="margin-top:18px; overflow:auto">
            <table class="table">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th class="right">Acciones</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.attachOrderFilterEvents();
  }

  attachOrderFilterEvents() {
    const fromInput = Utils.$('#ordersFrom');
    if (fromInput) {
      fromInput.addEventListener('change', (e) => {
        const val = this.normalizeDateInput(e.target.value);
        this.updateOrderFilters({from: val});
      });
    }

    const toInput = Utils.$('#ordersTo');
    if (toInput) {
      toInput.addEventListener('change', (e) => {
        const val = this.normalizeDateInput(e.target.value);
        this.updateOrderFilters({to: val});
      });
    }

    const searchInput = Utils.$('#ordersSearch');
    if (searchInput) {
      let timeout = null;
      searchInput.addEventListener('input', (e) => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          this.updateOrderFilters({search: e.target.value || ''});
        }, 250);
      });
    }

    const resetBtn = Utils.$('#ordersReset');
    if (resetBtn) {
      resetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.resetOrderFilters();
      });
    }
  }

  attachReportFilterEvents(orders, expenses) {
    const presetSelect = Utils.$('#reportPreset');
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        const val = e.target.value || '30';
        this.applyReportPreset(val);
        this.updateReportFilters({preset: val, from: this.reportFilters.from, to: this.reportFilters.to});
      });
    }

    const fromInput = Utils.$('#reportFrom');
    if (fromInput) {
      fromInput.addEventListener('change', (e) => {
        this.updateReportFilters({from: this.normalizeDateInput(e.target.value), preset: 'custom'});
      });
    }

    const toInput = Utils.$('#reportTo');
    if (toInput) {
      toInput.addEventListener('change', (e) => {
        this.updateReportFilters({to: this.normalizeDateInput(e.target.value), preset: 'custom'});
      });
    }

    const searchInput = Utils.$('#reportSearch');
    if (searchInput) {
      let timeout = null;
      searchInput.addEventListener('input', (e) => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          this.updateReportFilters({search: e.target.value || ''});
        }, 250);
      });
    }

    const resetBtn = Utils.$('#reportReset');
    if (resetBtn) {
      resetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.resetReportFilters();
      });
    }

    const exportBtn = Utils.$('#reportExport');
    if (exportBtn) {
      exportBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.exportReportData(orders, expenses);
      });
    }

    const importBtn = Utils.$('#reportImport');
    const importInput = Utils.$('#reportImportFile');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', (e) => {
        e.preventDefault();
        importInput.value = '';
        importInput.click();
      });
      importInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          this.importExpensesFile(file);
        }
      });
    }
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
          <label>celular</label>
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
          <label>Celular</label>
          <input type="tel" id="stylistPhone" placeholder="5551234567" value="${this.safeValue(stylist && stylist.celular)}">
        </div>
        <div>
          <label>% Comisi\u00F3n</label>
          <input type="number" id="stylistPct" min="0" max="100" step="0.5" value="${this.safeValue((stylist && stylist.pct) != null ? stylist.pct : (stylist && stylist.porcentaje) != null ? stylist.porcentaje : 0)}">
        </div>
        <div>
          <label>Sueldo base</label>
          <input type="number" id="stylistBase" min="0" step="0.01" placeholder="0.00" value="${this.safeValue((stylist && stylist.base_salary) != null ? stylist.base_salary : 0)}">
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
    const baseEl = Utils.$('#stylistBase');

    const nombre = Utils.cleanTxt((nameEl ? nameEl.value : '') || '');
    if (!nombre) {
      Utils.toast('El nombre es obligatorio', 'warn');
      return false;
    }

    const cap = Number((this.settings && this.settings.commission_cap) || 20);
    const pct = Utils.clamp(Number((pctEl ? pctEl.value : '') || 0), 0, cap);
    const baseSalary = Math.max(0, Number((baseEl ? baseEl.value : '') || 0));
    const record = {
      id: stylistId || undefined,
      nombre,
      rol: Utils.cleanTxt((roleEl ? roleEl.value : '') || ''),
      celular: Utils.cleanTxt((phoneEl ? phoneEl.value : '') || ''),
      pct,
      base_salary: baseSalary
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
    const cap = Number((this.settings && this.settings.commission_cap) || 20);

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
            pct: Utils.clamp(Number(pctValue), 0, cap)
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
            return Object.assign({}, sel, {nombre: ref.nombre, pct: Utils.clamp(Number(sel.pct != null ? sel.pct : (ref.pct != null ? ref.pct : 0)), 0, cap)});
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
    if (!main) return;

    const filters = this.expenseFilters || {};
    const from = filters.from ? new Date(filters.from + 'T00:00:00') : null;
    const to = filters.to ? new Date(filters.to + 'T23:59:59') : null;
    const catFilter = filters.category || '';
    const statusFilter = filters.status || 'all';
    const q = (filters.search || '').toLowerCase();

    const expenses = await this.database.getAll('expenses');
    const categories = await this.database.getAll('expense_categories');

    const match = (exp) => {
      const date = new Date(exp.fecha || exp.fecha_hora || Date.now());
      if (from && date < from) return false;
      if (to && date > to) return false;
      if (catFilter && exp.categoria !== catFilter) return false;
      if (statusFilter !== 'all') {
        const st = (exp.status || 'ejecutado').toLowerCase();
        if (st !== statusFilter) return false;
      }
      if (q) {
        const txt = `${exp.nombre || ''} ${exp.descripcion || ''} ${exp.categoria || ''}`.toLowerCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    };

    const filtered = (expenses || []).filter(match).sort((a, b) => {
      const ad = new Date(a.fecha || a.fecha_hora || 0).getTime();
      const bd = new Date(b.fecha || b.fecha_hora || 0).getTime();
      return bd - ad;
    });

    const totalEjecutado = filtered.reduce((s, e) => s + ((e.status || 'ejecutado') === 'ejecutado' ? Number(e.monto || e.total || 0) : 0), 0);
    const totalPendiente = filtered.reduce((s, e) => s + ((e.status || 'ejecutado') === 'pendiente' ? Number(e.monto || e.total || 0) : 0), 0);

    const optionsCat = [`<option value="">Todas</option>`]
      .concat(categories.map(c => `<option value="${c.nombre}" ${c.nombre === catFilter ? 'selected' : ''}>${this.safeValue(c.nombre || '')}</option>`))
      .join('');

    const rowsHTML = filtered.map(exp => {
      const status = (exp.status || 'ejecutado').toLowerCase();
      return `
        <tr data-id="${exp.id}">
          <td>${(exp.fecha || '').slice(0,10)}</td>
          <td>${this.safeValue(exp.nombre || '')}</td>
          <td>${this.safeValue(exp.categoria || '')}</td>
          <td class="right">${Utils.money(exp.monto || exp.total || 0)}</td>
          <td>${status === 'pendiente' ? '<span class="warn">Pendiente</span>' : '<span class="ok">Ejecutado</span>'}</td>
          <td class="small">${this.safeValue(exp.descripcion || '')}</td>
          <td class="right">
            ${status === 'pendiente' ? `<button class="btn tiny" data-action="exec">Ejecutar</button>` : ''}
            <button class="btn tiny err" data-action="del">&times;</button>
          </td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="7" class="center muted">Sin gastos</td>';

    main.innerHTML = `
      <div class="card">
        <h3>Gastos</h3>
        <div class="pad stack">
          <div class="row" style="flex-wrap:wrap; gap:8px">
            <div>
              <label>Del</label>
              <input type="date" id="expFrom" value="${filters.from || ''}">
            </div>
            <div>
              <label>Al</label>
              <input type="date" id="expTo" value="${filters.to || ''}">
            </div>
            <div>
              <label>Categor\u00eda</label>
              <select id="expCategory">${optionsCat}</select>
            </div>
            <div>
              <label>Estado</label>
              <select id="expStatus">
                <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>Todos</option>
                <option value="ejecutado" ${statusFilter === 'ejecutado' ? 'selected' : ''}>Ejecutado</option>
                <option value="pendiente" ${statusFilter === 'pendiente' ? 'selected' : ''}>Pendiente</option>
              </select>
            </div>
            <div style="flex:1; min-width:180px">
              <label>Buscar</label>
              <input type="text" id="expSearch" placeholder="Nombre, descripci\u00f3n, categor\u00eda" value="${filters.search || ''}">
            </div>
            <button class="btn" id="expApply">Filtrar</button>
          </div>

          <div class="row" style="gap:16px; flex-wrap:wrap">
            <div class="pill">Pendiente: <strong>${Utils.money(totalPendiente)}</strong></div>
            <div class="pill ok">Ejecutado: <strong>${Utils.money(totalEjecutado)}</strong></div>
          </div>

          <div class="card muted" style="background:#f9fbfb">
            <div class="row" style="flex-wrap:wrap; gap:10px">
              <div>
                <label>Nombre</label>
                <input type="text" id="expName" placeholder="Renta, servicios...">
              </div>
              <div>
                <label>Fecha</label>
                <input type="date" id="expDate" value="${new Date().toISOString().slice(0,10)}">
              </div>
              <div>
                <label>Monto</label>
                <input type="number" id="expAmount" min="0" step="0.01" placeholder="0.00">
              </div>
              <div>
                <label>Categor\u00eda</label>
                <select id="expCatSelect">${optionsCat}</select>
              </div>
              <div>
                <label>Estado</label>
                <select id="expStatusNew">
                  <option value="ejecutado">Ejecutado</option>
                  <option value="pendiente">Programado</option>
                </select>
              </div>
              <div style="flex:1; min-width:200px">
                <label>Descripci\u00f3n</label>
                <input type="text" id="expDesc" placeholder="Detalle, folio, referencia">
              </div>
              <button class="btn" id="expAdd">Agregar</button>
            </div>
            <div class="row" style="gap:8px; margin-top:8px">
              <div>
                <label>Nueva categor\u00eda</label>
                <input type="text" id="expCatNew" placeholder="Nombre categor\u00eda">
              </div>
              <button class="btn tiny" id="expCatAdd">Agregar categor\u00eda</button>
            </div>
          </div>

          <div style="overflow:auto">
            <table class="table" id="expTable">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Nombre</th>
                  <th>Categor\u00eda</th>
                  <th class="right">Monto</th>
                  <th>Estado</th>
                  <th>Descripci\u00f3n</th>
                  <th class="right">Acciones</th>
                </tr>
              </thead>
              <tbody>${rowsHTML}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const applyFilters = () => {
      this.expenseFilters = {
        from: Utils.$('#expFrom').value || '',
        to: Utils.$('#expTo').value || '',
        category: Utils.$('#expCategory').value || '',
        status: Utils.$('#expStatus').value || 'all',
        search: Utils.$('#expSearch').value || ''
      };
      this.renderExpenses();
    };
    const applyBtn = Utils.$('#expApply');
    if (applyBtn) applyBtn.onclick = applyFilters;

    const addBtn = Utils.$('#expAdd');
    if (addBtn) {
      addBtn.onclick = async () => {
        try {
          const name = Utils.cleanTxt(Utils.$('#expName').value || '');
          const date = Utils.$('#expDate').value || new Date().toISOString().slice(0,10);
          const amount = Number(Utils.$('#expAmount').value || 0);
          const cat = Utils.$('#expCatSelect').value || '';
          const status = Utils.$('#expStatusNew').value || 'ejecutado';
          const desc = Utils.cleanTxt(Utils.$('#expDesc').value || '');

          if (!name) return Utils.toast('Nombre requerido', 'warn');
          if (amount <= 0) return Utils.toast('Monto inv\u00e1lido', 'warn');

          await this.database.put('expenses', {
            id: this.database.uid(),
            nombre: name,
            descripcion: desc,
            categoria: cat,
            monto: amount,
            fecha: date,
            status
          });
          Utils.toast('Gasto guardado', 'ok');
          await this.renderExpenses();
        } catch (err) {
          console.error('Add expense', err);
          Utils.toast('No se pudo guardar', 'err');
        }
      };
    }

    const addCatBtn = Utils.$('#expCatAdd');
    if (addCatBtn) {
      addCatBtn.onclick = async () => {
        const val = Utils.cleanTxt(Utils.$('#expCatNew').value || '');
        if (!val) return Utils.toast('Nombre de categor\u00eda requerido', 'warn');
        await this.database.put('expense_categories', {id: this.database.uid(), nombre: val});
        Utils.toast('Categor\u00eda agregada', 'ok');
        await this.renderExpenses();
      };
    }

    const table = Utils.$('#expTable');
    if (table) {
      table.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-action]');
        if (!btn) return;
        const tr = btn.closest('tr[data-id]');
        const id = tr ? tr.getAttribute('data-id') : null;
        if (!id) return;
        if (btn.dataset.action === 'del') {
          if (!window.confirm('\u00bfEliminar gasto?')) return;
          await this.database.delete('expenses', id);
          Utils.toast('Gasto eliminado', 'warn');
          await this.renderExpenses();
        } else if (btn.dataset.action === 'exec') {
          const exp = expenses.find(e => e.id === id);
          if (!exp) return;
          exp.status = 'ejecutado';
          if (!exp.fecha || exp.fecha > new Date().toISOString().slice(0,10)) {
            exp.fecha = new Date().toISOString().slice(0,10);
          }
          await this.database.put('expenses', exp);
          Utils.toast('Gasto ejecutado', 'ok');
          await this.renderExpenses();
        }
      });
    }
  }

  async renderPurchases() {
    const main = Utils.$('#main');
    if (!main) return;

    const filters = this.purchaseFilters || {};
    const from = filters.from ? new Date(filters.from + 'T00:00:00') : null;
    const to = filters.to ? new Date(filters.to + 'T23:59:59') : null;
    const supplierFilter = filters.supplier || '';
    const statusFilter = filters.status || 'all';
    const q = (filters.search || '').toLowerCase();

    const purchases = await this.database.getAll('purchases');
    const suppliers = await this.database.getAll('suppliers');
    const supplierMap = new Map(suppliers.map(s => [s.id, s.nombre]));

    const match = (p) => {
      const date = new Date(p.fecha || p.fecha_hora || Date.now());
      if (from && date < from) return false;
      if (to && date > to) return false;
      if (supplierFilter && p.supplier_id !== supplierFilter) return false;
      if (statusFilter !== 'all') {
        const st = (p.status || 'ejecutado').toLowerCase();
        if (st !== statusFilter) return false;
      }
      if (q) {
        const txt = `${p.nombre || ''} ${p.descripcion || ''} ${p.categoria || ''} ${p.proveedor || ''}`.toLowerCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    };

    const filtered = (purchases || []).filter(match).sort((a, b) => {
      const ad = new Date(a.fecha || a.fecha_hora || 0).getTime();
      const bd = new Date(b.fecha || b.fecha_hora || 0).getTime();
      return bd - ad;
    });

    const totalEjecutado = filtered.reduce((s, e) => s + ((e.status || 'ejecutado') === 'ejecutado' ? Number(e.monto || e.total || 0) : 0), 0);
    const totalPendiente = filtered.reduce((s, e) => s + ((e.status || 'ejecutado') === 'pendiente' ? Number(e.monto || e.total || 0) : 0), 0);

    const supplierOptions = [`<option value="">Todos</option>`]
      .concat(suppliers.map(s => `<option value="${s.id}" ${s.id === supplierFilter ? 'selected' : ''}>${this.safeValue(s.nombre || '')}</option>`))
      .join('');

    const rowsHTML = filtered.map(p => {
      const status = (p.status || 'ejecutado').toLowerCase();
      const prov = this.safeValue(p.proveedor || supplierMap.get(p.supplier_id) || '');
      return `
        <tr data-id="${p.id}">
          <td>${(p.fecha || '').slice(0,10)}</td>
          <td>${this.safeValue(p.nombre || '')}</td>
          <td>${prov}</td>
          <td>${this.safeValue(p.categoria || '')}</td>
          <td class="right">${Utils.money(p.monto || p.total || 0)}</td>
          <td>${status === 'pendiente' ? '<span class="warn">Pendiente</span>' : '<span class="ok">Ejecutado</span>'}</td>
          <td class="small">${this.safeValue(p.descripcion || '')}</td>
          <td class="right">
            ${status === 'pendiente' ? `<button class="btn tiny" data-action="exec">Ejecutar</button>` : ''}
            <button class="btn tiny err" data-action="del">&times;</button>
          </td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="8" class="center muted">Sin compras</td>';

    main.innerHTML = `
      <div class="card">
        <h3>Compras</h3>
        <div class="pad stack">
          <div class="row" style="flex-wrap:wrap; gap:8px">
            <div>
              <label>Del</label>
              <input type="date" id="purFrom" value="${filters.from || ''}">
            </div>
            <div>
              <label>Al</label>
              <input type="date" id="purTo" value="${filters.to || ''}">
            </div>
            <div>
              <label>Proveedor</label>
              <select id="purSupplier">${supplierOptions}</select>
            </div>
            <div>
              <label>Estado</label>
              <select id="purStatus">
                <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>Todos</option>
                <option value="ejecutado" ${statusFilter === 'ejecutado' ? 'selected' : ''}>Ejecutado</option>
                <option value="pendiente" ${statusFilter === 'pendiente' ? 'selected' : ''}>Pendiente</option>
              </select>
            </div>
            <div style="flex:1; min-width:180px">
              <label>Buscar</label>
              <input type="text" id="purSearch" placeholder="Nombre, descripción, proveedor" value="${filters.search || ''}">
            </div>
            <button class="btn" id="purApply">Filtrar</button>
          </div>

          <div class="row" style="gap:16px; flex-wrap:wrap">
            <div class="pill">Pendiente: <strong>${Utils.money(totalPendiente)}</strong></div>
            <div class="pill ok">Ejecutado: <strong>${Utils.money(totalEjecutado)}</strong></div>
          </div>

          <div class="card muted" style="background:#f9fbfb">
            <div class="row" style="flex-wrap:wrap; gap:10px">
              <div>
                <label>Nombre</label>
                <input type="text" id="purName" placeholder="Compra de insumos...">
              </div>
              <div>
                <label>Fecha</label>
                <input type="date" id="purDate" value="${new Date().toISOString().slice(0,10)}">
              </div>
              <div>
                <label>Monto</label>
                <input type="number" id="purAmount" min="0" step="0.01" placeholder="0.00">
              </div>
              <div>
                <label>Proveedor</label>
                <select id="purSupplierNew">${supplierOptions.replace('Todos','Seleccione')}</select>
              </div>
              <div>
                <label>Categor�a</label>
                <input type="text" id="purCategory" placeholder="Categor�a/etiqueta">
              </div>
              <div>
                <label>Estado</label>
                <select id="purStatusNew">
                  <option value="ejecutado">Ejecutado</option>
                  <option value="pendiente">Programado</option>
                </select>
              </div>
              <div style="flex:1; min-width:200px">
                <label>Descripción</label>
                <input type="text" id="purDesc" placeholder="Detalle, folio, referencia">
              </div>
              <button class="btn" id="purAdd">Agregar</button>
            </div>
          </div>

          <div style="overflow:auto">
            <table class="table" id="purTable">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Nombre</th>
                  <th>Proveedor</th>
                  <th>Categor�a</th>
                  <th class="right">Monto</th>
                  <th>Estado</th>
                  <th>Descripción</th>
                  <th class="right">Acciones</th>
                </tr>
              </thead>
              <tbody>${rowsHTML}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const applyFilters = () => {
      this.purchaseFilters = {
        from: Utils.$('#purFrom').value || '',
        to: Utils.$('#purTo').value || '',
        supplier: Utils.$('#purSupplier').value || '',
        status: Utils.$('#purStatus').value || 'all',
        search: Utils.$('#purSearch').value || ''
      };
      this.renderPurchases();
    };
    const applyBtn = Utils.$('#purApply');
    if (applyBtn) applyBtn.onclick = applyFilters;

    const addBtn = Utils.$('#purAdd');
    if (addBtn) {
      addBtn.onclick = async () => {
        try {
          const name = Utils.cleanTxt(Utils.$('#purName').value || '');
          const date = Utils.$('#purDate').value || new Date().toISOString().slice(0,10);
          const amount = Number(Utils.$('#purAmount').value || 0);
          const supplierId = Utils.$('#purSupplierNew').value || '';
          const supplierName = supplierMap.get(supplierId) || '';
          const category = Utils.cleanTxt(Utils.$('#purCategory').value || '');
          const status = Utils.$('#purStatusNew').value || 'ejecutado';
          const desc = Utils.cleanTxt(Utils.$('#purDesc').value || '');

          if (!name) return Utils.toast('Nombre requerido', 'warn');
          if (amount <= 0) return Utils.toast('Monto inválido', 'warn');

          await this.database.put('purchases', {
            id: this.database.uid(),
            nombre: name,
            descripcion: desc,
            categoria: category,
            supplier_id: supplierId || null,
            proveedor: supplierName,
            monto: amount,
            fecha: date,
            status
          });
          Utils.toast('Compra guardada', 'ok');
          await this.renderPurchases();
        } catch (err) {
          console.error('Add purchase', err);
          Utils.toast('No se pudo guardar', 'err');
        }
      };
    }

    const table = Utils.$('#purTable');
    if (table) {
      table.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-action]');
        if (!btn) return;
        const tr = btn.closest('tr[data-id]');
        const id = tr ? tr.getAttribute('data-id') : null;
        if (!id) return;
        if (btn.dataset.action === 'del') {
          if (!window.confirm('�Eliminar compra?')) return;
          await this.database.delete('purchases', id);
          Utils.toast('Compra eliminada', 'warn');
          await this.renderPurchases();
        } else if (btn.dataset.action === 'exec') {
          const rec = purchases.find(p => p.id === id);
          if (!rec) return;
          rec.status = 'ejecutado';
          if (!rec.fecha || rec.fecha > new Date().toISOString().slice(0,10)) {
            rec.fecha = new Date().toISOString().slice(0,10);
          }
          await this.database.put('purchases', rec);
          Utils.toast('Compra ejecutada', 'ok');
          await this.renderPurchases();
        }
      });
    }
  }

    async renderSuppliers() {
    const main = Utils.$('#main');
    if (!main) return;

    const suppliers = await this.database.getAll('suppliers');
    const q = (this.supplierSearch || '').toLowerCase();
    const filtered = (suppliers || []).filter(s => {
      const txt = `${s.nombre || ''} ${s.contacto || ''} ${s.telefono || ''} ${s.email || ''}`.toLowerCase();
      return !q || txt.includes(q);
    });

    const rowsHTML = filtered.map(s => `
      <tr data-id="${s.id}">
        <td>${this.safeValue(s.nombre || '')}</td>
        <td>${this.safeValue(s.contacto || '')}</td>
        <td>${this.safeValue(s.telefono || '')}</td>
        <td>${this.safeValue(s.email || '')}</td>
        <td class="small">${this.safeValue(s.notas || '')}</td>
        <td class="right">
          <button class="btn tiny err" data-action="del">&times;</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="6" class="center muted">Sin proveedores</td>';

    main.innerHTML = `
      <div class="card">
        <h3>Proveedores</h3>
        <div class="pad stack">
          <div class="row" style="flex-wrap:wrap; gap:8px">
            <div style="flex:1">
              <label>Buscar</label>
              <input type="text" id="supSearch" placeholder="Nombre, contacto, celular, email" value="${this.supplierSearch || ''}">
            </div>
            <button class="btn" id="supApply">Filtrar</button>
          </div>

          <div class="card muted" style="background:#f9fbfb">
            <div class="row" style="flex-wrap:wrap; gap:10px">
              <div>
                <label>Nombre</label>
                <input type="text" id="supName" placeholder="Proveedor S.A.">
              </div>
              <div>
                <label>Contacto</label>
                <input type="text" id="supContact" placeholder="Persona contacto">
              </div>
              <div>
                <label>Celular</label>
                <input type="tel" id="supPhone" placeholder="5551234567">
              </div>
              <div>
                <label>Email</label>
                <input type="email" id="supEmail" placeholder="correo@proveedor.com">
              </div>
              <div style="flex:1; min-width:200px">
                <label>Notas</label>
                <input type="text" id="supNotes" placeholder="Condiciones, horarios">
              </div>
              <button class="btn" id="supAdd">Agregar</button>
            </div>
          </div>

          <div style="overflow:auto">
            <table class="table" id="supTable">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Contacto</th>
                  <th>Celular</th>
                  <th>Email</th>
                  <th>Notas</th>
                  <th class="right">Acciones</th>
                </tr>
              </thead>
              <tbody>${rowsHTML}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const applyBtn = Utils.$('#supApply');
    if (applyBtn) applyBtn.onclick = () => {
      this.supplierSearch = Utils.$('#supSearch').value || '';
      this.renderSuppliers();
    };

    const addBtn = Utils.$('#supAdd');
    if (addBtn) {
      addBtn.onclick = async () => {
        const name = Utils.cleanTxt(Utils.$('#supName').value || '');
        const contact = Utils.cleanTxt(Utils.$('#supContact').value || '');
        const phone = Utils.cleanTxt(Utils.$('#supPhone').value || '');
        const email = Utils.cleanTxt(Utils.$('#supEmail').value || '');
        const notes = Utils.cleanTxt(Utils.$('#supNotes').value || '');
        if (!name) return Utils.toast('Nombre requerido', 'warn');
        await this.database.put('suppliers', {
          id: this.database.uid(),
          nombre: name,
          contacto: contact,
          telefono: phone,
          email,
          notas: notes
        });
        Utils.toast('Proveedor agregado', 'ok');
        await this.renderSuppliers();
      };
    }

    const table = Utils.$('#supTable');
    if (table) {
      table.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-action]');
        if (!btn) return;
        const tr = btn.closest('tr[data-id]');
        const id = tr ? tr.getAttribute('data-id') : null;
        if (!id) return;
        if (btn.dataset.action === 'del') {
          if (!window.confirm('?Eliminar proveedor?')) return;
          await this.database.delete('suppliers', id);
          Utils.toast('Proveedor eliminado', 'warn');
          await this.renderSuppliers();
        }
      });
    }
  }

  async renderPayroll() {
    return this.renderPayroll2();
  }

  async renderReports() {
    const main = Utils.$('#main');
    if (!main) return;

    const orders = await this.database.getAll('pos_orders');
    const expenses = await this.database.getAll('expenses');
    const purchases = await this.database.getAll('purchases');
    const payroll = await this.database.getAll('payroll');
    const payrollPaid = (payroll || []).filter(p => (p.status || 'pendiente').toLowerCase() === 'pagado').map(p => ({
      id: p.id,
      nombre: p.concepto || 'N�mina',
      descripcion: p.notas || '',
      categoria: 'N�mina',
      monto: Number(p.commission || p.monto || p.amount || 0),
      fecha: (p.fecha_hora || p.fecha || '').slice(0, 10),
      status: 'ejecutado'
    }));
    const allExpenses = []
      .concat(expenses || [])
      .concat(purchases || [])
      .concat(payrollPaid || []);
    const filters = this.reportFilters || {};
    const from = filters.from ? new Date(filters.from + 'T00:00:00') : null;
    const to = filters.to ? new Date(filters.to + 'T23:59:59') : null;
    const q = (filters.search || '').toLowerCase();

    const matchOrder = (order) => {
      const date = new Date(order.fecha_hora || order.fecha || Date.now());
      if (from && date < from) return false;
      if (to && date > to) return false;
      if (q) {
        const folio = (order.folio || '').toLowerCase();
        const name = ((order.customer && order.customer.nombre) || 'cliente general').toLowerCase();
        if (!folio.includes(q) && !name.includes(q)) return false;
      }
      return true;
    };

    const matchExpense = (expense) => {
      const date = new Date(expense.fecha || expense.fecha_hora || Date.now());
      if (from && date < from) return false;
      if (to && date > to) return false;
      if ((expense.status || 'ejecutado') === 'pendiente') return false;
      if (q) {
        const concept = ((expense.nombre || expense.descripcion || '') + ' ' + (expense.categoria || '')).toLowerCase();
        if (!concept.includes(q)) return false;
      }
      return true;
    };

    const filteredOrders = (orders || []).filter(matchOrder).sort((a, b) => {
      const ad = new Date(a.fecha_hora || a.fecha || 0).getTime();
      const bd = new Date(b.fecha_hora || b.fecha || 0).getTime();
      return bd - ad;
    });

    const filteredExpenses = (allExpenses || []).filter(matchExpense).sort((a, b) => {
      const ad = new Date(a.fecha || a.fecha_hora || 0).getTime();
      const bd = new Date(b.fecha || b.fecha_hora || 0).getTime();
      return bd - ad;
    });

    const rawIva = Number(this.settings && this.settings.iva_rate);
    const ivaRateSetting = Number.isFinite(rawIva) && rawIva > 0 ? rawIva : 0.16;

    const tips = filteredOrders.reduce((sum, order) => sum + Number(order.tipTotal || 0), 0);
    const grossSales = filteredOrders.reduce((sum, order) => {
      const total = Number(order.total || 0);
      const tipLine = Number(order.tipTotal || 0);
      return sum + Math.max(0, total - tipLine);
    }, 0);
    // IVA: todos los precios incluyen impuesto, se calcula como 16% de los ingresos brutos
    const ivaSum = Number((grossSales * ivaRateSetting).toFixed(2));
    const netSales = grossSales - ivaSum;
    const expenseTotal = filteredExpenses.reduce((sum, exp) => sum + Number(exp.monto || exp.total || 0), 0);
    const netIncome = netSales - expenseTotal;
    const count = filteredOrders.length;
    const avg = count ? grossSales / count : 0;

    const byDay = {};
    filteredOrders.forEach(order => {
      const key = (order.fecha_hora || order.fecha || '').slice(0, 10) || 'sin-fecha';
      if (!byDay[key]) {
        byDay[key] = {total: 0, count: 0};
      }
      byDay[key].total += Number(order.total || 0);
      byDay[key].count += 1;
    });

    const cashFlow = {};
    filteredOrders.forEach(order => {
      const key = (order.fecha_hora || order.fecha || '').slice(0, 10) || 'sin-fecha';
      if (!cashFlow[key]) cashFlow[key] = {in: 0, out: 0};
      cashFlow[key].in += Number(order.total || 0);
    });
    filteredExpenses.forEach(exp => {
      const key = (exp.fecha || exp.fecha_hora || '').slice(0, 10) || 'sin-fecha';
      if (!cashFlow[key]) cashFlow[key] = {in: 0, out: 0};
      cashFlow[key].out += Number(exp.monto || exp.total || 0);
    });

    const rows = Object.keys(byDay).sort((a, b) => {
      return new Date(b).getTime() - new Date(a).getTime();
    }).map(dateKey => {
      const info = byDay[dateKey];
      const label = new Date(dateKey).toLocaleDateString('es-MX');
      return `
        <tr>
          <td>${label}</td>
          <td>${info.count}</td>
          <td>${Utils.money(info.total)}</td>
          <td>${Utils.money(info.total / info.count || 0)}</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="4" class="center muted">Sin datos</td></tr>';

    const cashRows = Object.keys(cashFlow).sort((a, b) => {
      return new Date(b).getTime() - new Date(a).getTime();
    }).map(dateKey => {
      const info = cashFlow[dateKey];
      const label = new Date(dateKey).toLocaleDateString('es-MX');
      const net = info.in - info.out;
      return `
        <tr>
          <td>${label}</td>
          <td>${Utils.money(info.in)}</td>
          <td>${Utils.money(info.out)}</td>
          <td class="${net >= 0 ? 'success' : 'danger'}">${Utils.money(net)}</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="4" class="center muted">Sin datos</td></tr>';

    this.lastReportData = {orders: filteredOrders, expenses: filteredExpenses};

    main.innerHTML = `
      <div class="card">
        <h3>Reportes (filtrado)</h3>
        <div class="pad">
          <div class="row" style="gap:12px;flex-wrap:wrap">
            <div>
              <label>Periodo</label>
              <select id="reportPreset">
                <option value="7"${filters.preset === '7' ? ' selected' : ''}>\u00daltimos 7 d\u00edas</option>
                <option value="30"${(!filters.preset || filters.preset === '30') ? ' selected' : ''}>\u00daltimos 30 d\u00edas</option>
                <option value="ytd"${filters.preset === 'ytd' ? ' selected' : ''}>A\u00f1o en curso</option>
                <option value="custom"${filters.preset === 'custom' ? ' selected' : ''}>Personalizado</option>
              </select>
            </div>
            <div>
              <label>Del</label>
              <input type="date" id="reportFrom" value="${this.safeValue(filters.from || '')}">
            </div>
            <div>
              <label>Al</label>
              <input type="date" id="reportTo" value="${this.safeValue(filters.to || '')}">
            </div>
            <div style="flex:1;min-width:200px">
              <label>Buscar</label>
              <input type="text" id="reportSearch" placeholder="Folio, cliente o gasto" value="${this.safeValue(filters.search || '')}">
            </div>
            <div style="display:flex;align-items:flex-end">
              <button class="btn light" id="reportReset">Restablecer</button>
            </div>
          </div>

          <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">
            <button class="btn light" id="reportExport">Exportar CSV</button>
            <button class="btn light" id="reportImport">Importar gastos</button>
            <input type="file" id="reportImportFile" class="hidden" accept="application/json,text/json" style="display:none">
            <div class="muted small">La importaci\u00f3n acepta un arreglo JSON con campos: fecha, monto, categoria, descripcion.</div>
          </div>

          <div class="row" style="margin-top:16px;gap:12px;flex-wrap:wrap">
            <div class="card-lite" style="flex:1;min-width:160px">
              <div class="label-aux">Ingresos brutos</div>
              <div><strong>${Utils.money(grossSales)}</strong></div>
            </div>
            <div class="card-lite" style="flex:1;min-width:160px">
              <div class="label-aux">IVA incluido</div>
              <div><strong>${Utils.money(ivaSum)}</strong></div>
            </div>
            <div class="card-lite" style="flex:1;min-width:160px">
              <div class="label-aux">Ingresos netos</div>
              <div><strong>${Utils.money(netSales)}</strong></div>
            </div>
            <div class="card-lite" style="flex:1;min-width:160px">
              <div class="label-aux">Propinas</div>
              <div><strong>${Utils.money(tips)}</strong></div>
            </div>
            <div class="card-lite" style="flex:1;min-width:160px">
              <div class="label-aux">Gastos</div>
              <div><strong>${Utils.money(expenseTotal)}</strong></div>
            </div>
            <div class="card-lite" style="flex:1;min-width:160px">
              <div class="label-aux">Utilidad</div>
              <div class="${netIncome >= 0 ? 'success' : 'danger'}"><strong>${Utils.money(netIncome)}</strong></div>
            </div>
          </div>

          <h4>Estado de resultados</h4>
          <table class="table">
            <tbody>
              <tr>
                <td>Ingresos brutos</td>
                <td class="right">${Utils.money(grossSales)}</td>
              </tr>
              <tr>
                <td>IVA trasladado (informativo)</td>
                <td class="right">${Utils.money(ivaSum)}</td>
              </tr>
              <tr>
                <td>Ingresos netos (sin IVA)</td>
                <td class="right">${Utils.money(netSales)}</td>
              </tr>
              <tr>
                <td>Gastos operativos</td>
                <td class="right">-${Utils.money(expenseTotal)}</td>
              </tr>
              <tr>
                <td>Propinas (pas-through)</td>
                <td class="right">${Utils.money(tips)}</td>
              </tr>
              <tr>
                <td><strong>Utilidad neta</strong></td>
                <td class="right"><strong>${Utils.money(netIncome)}</strong></td>
              </tr>
            </tbody>
          </table>

          <h4>Flujo de efectivo</h4>
          <table class="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Entradas</th>
                <th>Salidas</th>
                <th>Neto</th>
              </tr>
            </thead>
            <tbody>${cashRows}</tbody>
          </table>

          <h4>Desglose diario</h4>
          <div style="overflow:auto">
            <table class="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tickets</th>
                  <th>Total</th>
                  <th>Promedio</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.attachReportFilterEvents(filteredOrders, filteredExpenses);
  }

  async renderSettings() {
    const main = Utils.$('#main');
    main.innerHTML = `
      <div class="card">
        <h3>Ajustes / Respaldo</h3>
        <div class="pad stack">
          <div class="row">
            <div>
              <label>IVA (%)</label>
              <input type="number" id="settingsIva" min="0" max="100" step="0.01" value="${Number((this.settings && this.settings.iva_rate) || 0.16) * 100}">
              <div class="muted small">Se aplica s\u00f3lo en reportes (precios incluyen IVA).</div>
            </div>
            <div>
              <label>Lealtad (%)</label>
              <input type="number" id="settingsLoyalty" min="0" max="50" step="0.1" value="${Number((this.settings && this.settings.loyalty_rate) || 0.02) * 100}">
              <div class="muted small">Puntos otorgados sobre el total del ticket.</div>
            </div>
            <div>
              <label>Tope comisi\u00f3n estilistas (%)</label>
              <input type="number" id="settingsCommissionCap" min="0" max="100" step="0.5" value="${Number((this.settings && this.settings.commission_cap) || 20)}">
              <div class="muted small">L\u00edmite m\u00e1ximo permitido al crear/editar estilistas.</div>
            </div>
          </div>

          <div class="row" style="flex-wrap:wrap; gap:12px">
            <div>
              <label>Frecuencia sueldo base</label>
              <select id="settingsBaseFreq">
                <option value="semanal" ${((this.settings && this.settings.payroll_base_freq) || 'quincenal') === 'semanal' ? 'selected' : ''}>Semanal</option>
                <option value="quincenal" ${((this.settings && this.settings.payroll_base_freq) || 'quincenal') === 'quincenal' ? 'selected' : ''}>Quincenal</option>
                <option value="mensual" ${((this.settings && this.settings.payroll_base_freq) || 'quincenal') === 'mensual' ? 'selected' : ''}>Mensual</option>
              </select>
            </div>
            <div>
              <label>Frecuencia comisiones</label>
              <select id="settingsCommFreq">
                <option value="semanal" ${((this.settings && this.settings.payroll_comm_freq) || 'semanal') === 'semanal' ? 'selected' : ''}>Semanal</option>
                <option value="quincenal" ${((this.settings && this.settings.payroll_comm_freq) || 'semanal') === 'quincenal' ? 'selected' : ''}>Quincenal</option>
                <option value="mensual" ${((this.settings && this.settings.payroll_comm_freq) || 'semanal') === 'mensual' ? 'selected' : ''}>Mensual</option>
              </select>
            </div>
            <div>
              <label>Frecuencia propinas</label>
              <select id="settingsTipFreq">
                <option value="semanal" ${((this.settings && this.settings.payroll_tip_freq) || 'semanal') === 'semanal' ? 'selected' : ''}>Semanal</option>
                <option value="quincenal" ${((this.settings && this.settings.payroll_tip_freq) || 'semanal') === 'quincenal' ? 'selected' : ''}>Quincenal</option>
                <option value="mensual" ${((this.settings && this.settings.payroll_tip_freq) || 'semanal') === 'mensual' ? 'selected' : ''}>Mensual</option>
              </select>
            </div>
          </div>

          <div class="row" style="align-items:flex-end; gap:12px; flex-wrap:wrap">
            <div style="flex:1">
              <label>M\u00e9todos de pago (separados por coma)</label>
              <input type="text" id="settingsPayments" value="${((this.settings && this.settings.payment_methods) || ['Efectivo','Tarjeta','Transferencia']).join(', ')}">
            </div>
            <button class="btn" id="settingsSave">Guardar ajustes</button>
          </div>
        </div>
      </div>
    `;

    const ivaEl = Utils.$('#settingsIva');
    const loyaltyEl = Utils.$('#settingsLoyalty');
    const capEl = Utils.$('#settingsCommissionCap');
    const payEl = Utils.$('#settingsPayments');
    const baseFreqEl = Utils.$('#settingsBaseFreq');
    const commFreqEl = Utils.$('#settingsCommFreq');
    const tipFreqEl = Utils.$('#settingsTipFreq');
    const saveBtn = Utils.$('#settingsSave');

    if (saveBtn) {
      saveBtn.onclick = async () => {
        try {
          const ivaPct = Math.max(0, Number(ivaEl.value || 0));
          const loyaltyPct = Math.max(0, Number(loyaltyEl.value || 0));
          const capPct = Math.max(0, Number(capEl.value || 0));
          const payments = (payEl.value || '').split(',').map(v => v.trim()).filter(Boolean);

          this.settings.iva_rate = ivaPct / 100;
          this.settings.loyalty_rate = loyaltyPct / 100;
          this.settings.commission_cap = capPct;
          this.settings.payment_methods = payments.length ? payments : ['Efectivo','Tarjeta','Transferencia'];
          this.settings.payroll_base_freq = baseFreqEl ? baseFreqEl.value : 'quincenal';
          this.settings.payroll_comm_freq = commFreqEl ? commFreqEl.value : 'semanal';
          this.settings.payroll_tip_freq = tipFreqEl ? tipFreqEl.value : 'semanal';

          await this.database.put('settings', this.settings);
          this.paymentMethods = this.settings.payment_methods;

          UIComponents.commissionCap = Number(this.settings.commission_cap || 20);
          this.syncPosStylistsFromMaster();

          Utils.toast('Ajustes guardados', 'ok');
          if (this.stateManager.activeTab === 'reports') {
            await this.renderReports();
          }
          if (this.stateManager.activeTab === 'pos') {
            await this.renderPOS();
          }
        } catch (error) {
          console.error('Guardar ajustes', error);
          Utils.toast('No se pudo guardar ajustes', 'err');
        }
      };
    }
  }

  async openOrderDetail(orderId) {
    try {
      const order = await this.database.getById('pos_orders', orderId);
      if (!order) {
        Utils.toast('Orden no encontrada', 'warn');
        return;
      }
      const allLines = await this.database.getAll('pos_lines');
      const lines = allLines.filter(line => line.order_id === orderId);
      const allTips = await this.database.getAll('pos_tips');
      const tips = allTips.filter(t => t.order_id === orderId);
      const stylistMap = new Map((this.stylists || []).map(s => [s.id, s.nombre]));

      const linesHTML = lines.length ? lines.map(line => {
        const stylists = Array.isArray(line.stylists) && line.stylists.length
          ? line.stylists.map(s => this.safeValue(s.nombre || '')).join(', ')
          : 'Sin estilistas';
        return `
          <tr>
            <td>${this.safeValue(line.variant && line.variant.nombre || 'Producto')}</td>
            <td class="right">${Number(line.qty || 1)}</td>
            <td class="right">${Utils.money(line.price || line.variant && line.variant.precio || 0)}</td>
            <td class="right">${Utils.money(line.lineTotal || 0)}</td>
            <td class="small muted">${stylists}</td>
          </tr>
        `;
      }).join('') : '<tr><td colspan="5" class="center muted">Sin renglones</td></tr>';

      const payHTML = (order.payments || []).length ? order.payments.map(pay => `
        <div class="row" style="justify-content:space-between">
          <div>${this.safeValue(pay.metodo || 'Pago')}</div>
          <div><strong>${Utils.money(pay.monto || 0)}</strong></div>
        </div>
      `).join('') : '<div class="muted small">Sin pagos registrados</div>';

      const tipsHTML = tips.length ? tips.map(t => {
        const name = stylistMap.get(t.stylist_id) || t.stylist_id || 'Estilista';
        return `
        <div class="row" style="justify-content:space-between">
          <div>${this.safeValue(name)}</div>
          <div><strong>${Utils.money(t.monto || 0)}</strong></div>
        </div>
      `;
      }).join('') : '<div class="muted small">Sin propinas registradas</div>';

      const infoHTML = `
        <div class="stack">
          <div class="card-lite">
            <div class="label-aux">Folio</div>
            <div><strong>${this.safeValue(order.folio || 'N/A')}</strong></div>
          </div>
          <div class="card-lite">
            <div class="label-aux">Fecha</div>
            <div>${new Date(order.fecha_hora || order.fecha || Date.now()).toLocaleString('es-MX')}</div>
          </div>
          <div class="card-lite">
            <div class="label-aux">Cliente</div>
            <div>${this.safeValue((order.customer && order.customer.nombre) || 'Cliente general')}</div>
          </div>
          <div class="card-lite">
            <div class="label-aux">Total</div>
            <div><strong>${Utils.money(order.total || 0)}</strong></div>
          </div>
        </div>

        <h4>Productos</h4>
        <div style="overflow:auto">
          <table class="table">
            <thead>
              <tr>
                <th>Concepto</th>
                <th class="right">Cant.</th>
                <th class="right">Precio</th>
                <th class="right">Importe</th>
                <th>Estilistas</th>
              </tr>
            </thead>
            <tbody>${linesHTML}</tbody>
          </table>
        </div>

        <h4>Pagos</h4>
        ${payHTML}

        <h4 style="margin-top:16px">Propinas</h4>
        ${tipsHTML}
      `;

      Utils.showModal('Detalle del ticket', infoHTML, {
        cancelText: 'Cerrar'
      });
    } catch (error) {
      console.error('Detalle de orden', error);
      Utils.toast('No se pudo cargar la orden', 'err');
    }
  }

  async printOrderTicket(orderId) {
    const order = await this.database.getById('pos_orders', orderId);
    if (!order) {
      Utils.toast('Orden no encontrada', 'warn');
      return;
    }
    Utils.toast('Funci\u00f3n de impresi\u00f3n en desarrollo...', 'warn');
  }

  openLineStylist(index) {
    const pos = this.stateManager.pos;
    const line = pos.lines[index];
    if (!line) {
      Utils.toast('Producto no encontrado', 'warn');
      return;
    }

    const variantName = this.safeValue((line.variant && line.variant.nombre) || 'Producto');
    const notes = Array.isArray(line.stylists) && line.stylists.length
      ? line.stylists.map(s => this.safeValue(s.nombre || '')).join(', ')
      : 'Sin asignaci\u00f3n';

    const stylistsOptions = (this.stylists || []).map(stylist => {
      const checked = line.stylists && line.stylists.some(s => s.id === stylist.id);
      return `
        <label class="row" style="align-items:center;gap:6px">
          <input type="radio" name="stylistRadio" value="${stylist.id}" ${checked ? 'checked' : ''}>
          <span>${this.safeValue(stylist.nombre || '')} (${stylist.pct || 0}%)</span>
        </label>
      `;
    }).join('') || '<div class="muted small">No hay estilistas definidos</div>';

    Utils.showModal(
      `Asignar estilista a ${variantName}`,
      `
        <div class="stack">
          <div>
            <label>Estilista</label>
            <div id="lineStylists">${stylistsOptions}</div>
          </div>
          <div class="muted small">Actual: ${notes}</div>
        </div>
      `,
      {
        okText: 'Guardar',
        cancelText: 'Cancelar',
        onOk: async () => {
          try {
            await this.applyLineStylist(index);
            Utils.toast('Estilista asignado', 'ok');
            this.renderTicketLines();
            this.renderTotals();
            this.renderPaymentMethods();
            return true;
          } catch (error) {
            console.error('Actualizar l�nea', error);
            Utils.toast(error.message || 'No se pudo guardar', 'err');
            return false;
          }
        }
      }
    );
  }

  async applyLineStylist(index) {
    const pos = this.stateManager.pos;
    const line = pos.lines[index];
    if (!line) throw new Error('L\u00ednea no encontrada');

    const stylistsContainer = Utils.$('#lineStylists');
    const radios = stylistsContainer ? stylistsContainer.querySelectorAll('input[type="radio"]') : [];
    const selected = Array.from(radios).find(r => r.checked);

    const stylistsMaster = this.stylists || [];
    const selectedStylist = selected ? stylistsMaster.find(s => s.id === selected.value) : null;
    const newStylists = selectedStylist ? [{id: selectedStylist.id, nombre: selectedStylist.nombre, pct: selectedStylist.pct}] : [];

    this.stateManager.updateLine(index, {stylists: newStylists});
    await this.renderPOS();
  }

  exportReportData(orders, expenses) {
    const rows = ['Tipo,Folio/ID,Fecha,Nombre,Total'];
    (orders || []).forEach(order => {
      const date = new Date(order.fecha_hora || order.fecha || Date.now()).toISOString();
      rows.push([
        'Orden',
        `"${(order.folio || '').replace(/"/g, '""')}"`,
        date,
        `"${(((order.customer && order.customer.nombre) || 'Cliente general')).replace(/"/g, '""')}"`,
        Number(order.total || 0).toFixed(2)
      ].join(','));
    });

    (expenses || []).forEach(exp => {
      const date = new Date(exp.fecha || exp.fecha_hora || Date.now()).toISOString();
      rows.push([
        'Gasto',
        `"${(exp.id || '').replace(/"/g, '""')}"`,
        date,
        `"${(((exp.nombre || exp.descripcion || '') + ' ' + (exp.categoria || '')).trim()).replace(/"/g, '""')}"`,
        -Number(exp.monto || exp.total || 0).toFixed(2)
      ].join(','));
    });

    const csv = rows.join('\n');
    Utils.downloadFile(`reportes_${Date.now()}.csv`, csv, 'text/csv');
  }

  async importExpensesFile(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) {
        throw new Error('Formato no soportado');
      }
      for (const entry of data) {
        const payload = {
          id: this.database.uid(),
          nombre: (entry.nombre || entry.descripcion || 'Gasto').toString(),
          descripcion: entry.descripcion || '',
          categoria: entry.categoria || 'General',
          monto: Number(entry.monto || 0),
          fecha: entry.fecha || new Date().toISOString().slice(0, 10)
        };
        await this.database.put('expenses', payload);
      }
      Utils.toast('Gastos importados', 'ok');
      await this.renderReports();
    } catch (error) {
      console.error('Import expenses', error);
      Utils.toast('No se pudo importar el archivo', 'err');
    }
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

// Módulo de cupones (fuera de la clase, usando el prototipo)
SalonPOSApp.prototype.renderCoupons = async function() {
  const main = Utils.$('#main');
  if (!main) return;

  const coupons = await this.database.getAll('coupons');
  const q = (this.couponSearch || '').toLowerCase();
  const filtered = (coupons || []).filter(c => {
    const txt = `${c.code || ''} ${c.descripcion || ''} ${c.tipo || ''}`.toLowerCase();
    return !q || txt.includes(q);
  }).sort((a, b) => (a.code || '').localeCompare(b.code || ''));

  const rowsHTML = filtered.map(c => {
    const vigencia = `${c.start_date || '—'} / ${c.end_date || '—'}`;
    const active = c.active ? '<span class="ok">Activo</span>' : '<span class="warn">Inactivo</span>';
    const tipo = c.type === 'percent' ? `${c.value || 0}%` : Utils.money(c.value || 0);
    return `
      <tr data-id="${c.id}">
        <td>${this.safeValue(c.code || '')}</td>
        <td>${tipo}</td>
        <td>${this.safeValue(c.min_purchase != null ? Utils.money(c.min_purchase) : '—')}</td>
        <td>${this.safeValue(c.max_discount != null ? Utils.money(c.max_discount) : '—')}</td>
        <td>${vigencia}</td>
        <td>${active}</td>
        <td class="right">
          <button class="btn tiny err" data-action="del">&times;</button>
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="7" class="center muted">Sin cupones</td>';

  main.innerHTML = `
    <div class="card">
      <h3>Cupones</h3>
      <div class="pad stack">
        <div class="row" style="flex-wrap:wrap; gap:8px">
          <div style="flex:1">
            <label>Buscar</label>
            <input type="text" id="couponSearch" placeholder="Código, descripción, tipo" value="${this.couponSearch || ''}">
          </div>
          <button class="btn" id="couponApply">Filtrar</button>
        </div>

        <div class="card muted" style="background:#f9fbfb">
          <div class="row" style="flex-wrap:wrap; gap:10px">
            <div>
              <label>Código</label>
              <input type="text" id="couponCode" placeholder="ABC123">
            </div>
            <div>
              <label>Tipo</label>
              <select id="couponType">
                <option value="amount">Monto fijo</option>
                <option value="percent">Porcentaje</option>
              </select>
            </div>
            <div>
              <label>Valor</label>
              <input type="number" id="couponValue" min="0" step="0.01" placeholder="0.00">
            </div>
            <div>
              <label>Mínimo de compra</label>
              <input type="number" id="couponMin" min="0" step="0.01" placeholder="0.00">
            </div>
            <div>
              <label>Tope de descuento</label>
              <input type="number" id="couponMax" min="0" step="0.01" placeholder="0.00">
            </div>
            <div>
              <label>Inicio</label>
              <input type="date" id="couponStart">
            </div>
            <div>
              <label>Fin</label>
              <input type="date" id="couponEnd">
            </div>
            <div class="row" style="align-items:center; gap:6px">
              <label class="small">Activo</label>
              <input type="checkbox" id="couponActive" checked>
            </div>
            <div style="flex:1; min-width:200px">
              <label>Descripción</label>
              <input type="text" id="couponDesc" placeholder="Opcional">
            </div>
            <button class="btn" id="couponAdd">Agregar</button>
          </div>
        </div>

        <div style="overflow:auto">
          <table class="table" id="couponTable">
            <thead>
              <tr>
                <th>Código</th>
                <th>Tipo</th>
                <th>Mínimo</th>
                <th>Tope</th>
                <th>Vigencia</th>
                <th>Estado</th>
                <th class="right">Acciones</th>
              </tr>
            </thead>
            <tbody>${rowsHTML}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const applyBtn = Utils.$('#couponApply');
  if (applyBtn) applyBtn.onclick = () => {
    this.couponSearch = Utils.$('#couponSearch').value || '';
    this.renderCoupons();
  };

  const addBtn = Utils.$('#couponAdd');
  if (addBtn) {
    addBtn.onclick = async () => {
      try {
        const code = Utils.cleanTxt(Utils.$('#couponCode').value || '');
        const type = Utils.$('#couponType').value || 'amount';
        const value = Number(Utils.$('#couponValue').value || 0);
        const minPurchase = Number(Utils.$('#couponMin').value || 0);
        const maxDiscount = Number(Utils.$('#couponMax').value || 0);
        const start = Utils.$('#couponStart').value || '';
        const end = Utils.$('#couponEnd').value || '';
        const active = !!Utils.$('#couponActive').checked;
        const desc = Utils.cleanTxt(Utils.$('#couponDesc').value || '');

        if (!code) return Utils.toast('Código requerido', 'warn');
        if (value <= 0) return Utils.toast('Valor inválido', 'warn');

        await this.database.put('coupons', {
          id: this.database.uid(),
          code: code.toUpperCase(),
          type,
          value,
          min_purchase: minPurchase,
          max_discount: maxDiscount,
          start_date: start,
          end_date: end,
          active,
          descripcion: desc
        });
        Utils.toast('Cupón guardado', 'ok');
        await this.renderCoupons();
      } catch (error) {
        console.error('Guardar cupón', error);
        Utils.toast('No se pudo guardar', 'err');
      }
    };
  }

  const table = Utils.$('#couponTable');
  if (table) {
    table.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if (!btn) return;
      const tr = btn.closest('tr[data-id]');
      const id = tr ? tr.getAttribute('data-id') : null;
      if (!id) return;
      if (btn.dataset.action === 'del') {
        if (!window.confirm('¿Eliminar cupón?')) return;
        await this.database.delete('coupons', id);
        Utils.toast('Cupón eliminado', 'warn');
        await this.renderCoupons();
      }
    });
  }
};

// Versión limpia del módulo de cupones (sobrescribe la anterior con textos corregidos)
SalonPOSApp.prototype.renderCoupons = async function renderCouponsClean() {
  const main = Utils.$('#main');
  if (!main) return;

  const coupons = await this.database.getAll('coupons');
  const q = (this.couponSearch || '').toLowerCase();
  const filtered = (coupons || []).filter(c => {
    const txt = `${c.code || ''} ${c.descripcion || ''} ${c.tipo || ''}`.toLowerCase();
    return !q || txt.includes(q);
  }).sort((a, b) => (a.code || '').localeCompare(b.code || ''));

  const rowsHTML = filtered.map(c => {
    const vigencia = `${c.start_date || 'N/D'} / ${c.end_date || 'N/D'}`;
    const active = c.active ? '<span class="ok">Activo</span>' : '<span class="warn">Inactivo</span>';
    const tipo = c.type === 'percent' ? `${c.value || 0}%` : Utils.money(c.value || 0);
    return `
      <tr data-id="${c.id}">
        <td>${this.safeValue(c.code || '')}</td>
        <td>${tipo}</td>
        <td>${this.safeValue(c.min_purchase != null ? Utils.money(c.min_purchase) : '—')}</td>
        <td>${this.safeValue(c.max_discount != null ? Utils.money(c.max_discount) : '—')}</td>
        <td>${vigencia}</td>
        <td>${active}</td>
        <td class="right">
          <button class="btn tiny err" data-action="del">&times;</button>
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="7" class="center muted">Sin cupones</td>';

  main.innerHTML = `
    <div class="card">
      <h3>Cupones</h3>
      <div class="pad stack">
        <div class="row" style="flex-wrap:wrap; gap:8px">
          <div style="flex:1">
            <label>Buscar</label>
            <input type="text" id="couponSearch" placeholder="Código, descripción, tipo" value="${this.couponSearch || ''}">
          </div>
          <button class="btn" id="couponApply">Filtrar</button>
        </div>

        <div class="card muted" style="background:#f9fbfb">
          <div class="row" style="flex-wrap:wrap; gap:10px">
            <div>
              <label>Código</label>
              <input type="text" id="couponCode" placeholder="ABC123">
            </div>
            <div>
              <label>Tipo</label>
              <select id="couponType">
                <option value="amount">Monto fijo</option>
                <option value="percent">Porcentaje</option>
              </select>
            </div>
            <div>
              <label>Valor</label>
              <input type="number" id="couponValue" min="0" step="0.01" placeholder="0.00">
            </div>
            <div>
              <label>Mínimo de compra</label>
              <input type="number" id="couponMin" min="0" step="0.01" placeholder="0.00">
            </div>
            <div>
              <label>Tope de descuento</label>
              <input type="number" id="couponMax" min="0" step="0.01" placeholder="0.00">
            </div>
            <div>
              <label>Inicio</label>
              <input type="date" id="couponStart">
            </div>
            <div>
              <label>Fin</label>
              <input type="date" id="couponEnd">
            </div>
            <div class="row" style="align-items:center; gap:6px">
              <label class="small">Activo</label>
              <input type="checkbox" id="couponActive" checked>
            </div>
            <div style="flex:1; min-width:200px">
              <label>Descripción</label>
              <input type="text" id="couponDesc" placeholder="Opcional">
            </div>
            <button class="btn" id="couponAdd">Agregar</button>
          </div>
        </div>

        <div style="overflow:auto">
          <table class="table" id="couponTable">
            <thead>
              <tr>
                <th>Código</th>
                <th>Tipo</th>
                <th>Mínimo</th>
                <th>Tope</th>
                <th>Vigencia</th>
                <th>Estado</th>
                <th class="right">Acciones</th>
              </tr>
            </thead>
            <tbody>${rowsHTML}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const applyBtn = Utils.$('#couponApply');
  if (applyBtn) applyBtn.onclick = () => {
    this.couponSearch = Utils.$('#couponSearch').value || '';
    this.renderCoupons();
  };

  const addBtn = Utils.$('#couponAdd');
  if (addBtn) {
    addBtn.onclick = async () => {
      try {
        const code = Utils.cleanTxt(Utils.$('#couponCode').value || '');
        const type = Utils.$('#couponType').value || 'amount';
        const value = Number(Utils.$('#couponValue').value || 0);
        const minPurchase = Number(Utils.$('#couponMin').value || 0);
        const maxDiscount = Number(Utils.$('#couponMax').value || 0);
        const start = Utils.$('#couponStart').value || '';
        const end = Utils.$('#couponEnd').value || '';
        const active = !!Utils.$('#couponActive').checked;
        const desc = Utils.cleanTxt(Utils.$('#couponDesc').value || '');

        if (!code) return Utils.toast('Código requerido', 'warn');
        if (value <= 0) return Utils.toast('Valor inválido', 'warn');

        await this.database.put('coupons', {
          id: this.database.uid(),
          code: code.toUpperCase(),
          type,
          value,
          min_purchase: minPurchase,
          max_discount: maxDiscount,
          start_date: start,
          end_date: end,
          active,
          descripcion: desc
        });
        Utils.toast('Cupón guardado', 'ok');
        await this.renderCoupons();
      } catch (error) {
        console.error('Guardar cupón', error);
        Utils.toast('No se pudo guardar', 'err');
      }
    };
  }

  const table = Utils.$('#couponTable');
  if (table) {
    table.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if (!btn) return;
      const tr = btn.closest('tr[data-id]');
      const id = tr ? tr.getAttribute('data-id') : null;
      if (!id) return;
      if (btn.dataset.action === 'del') {
        if (!window.confirm('¿Eliminar cupón?')) return;
        await this.database.delete('coupons', id);
        Utils.toast('Cupón eliminado', 'warn');
        await this.renderCoupons();
      }
    });
  }
};

// Bloque final en ASCII para evitar problemas de codificación
SalonPOSApp.prototype.renderCoupons = async function renderCouponsCleanAscii() {
  const main = Utils.$('#main');
  if (!main) return;

  const coupons = await this.database.getAll('coupons');
  const q = (this.couponSearch || '').toLowerCase();
  const filtered = (coupons || []).filter(c => {
    const txt = `${c.code || ''} ${c.descripcion || ''} ${c.tipo || ''}`.toLowerCase();
    return !q || txt.includes(q);
  }).sort((a, b) => (a.code || '').localeCompare(b.code || ''));

  const rowsHTML = filtered.map(c => {
    const vigencia = `${c.start_date || 'N/D'} / ${c.end_date || 'N/D'}`;
    const active = c.active ? '<span class="ok">Activo</span>' : '<span class="warn">Inactivo</span>';
    const tipo = c.type === 'percent' ? `${c.value || 0}%` : Utils.money(c.value || 0);
    return `
      <tr data-id="${c.id}">
        <td>${this.safeValue(c.code || '')}</td>
        <td>${tipo}</td>
        <td>${this.safeValue(c.min_purchase != null ? Utils.money(c.min_purchase) : '--')}</td>
        <td>${this.safeValue(c.max_discount != null ? Utils.money(c.max_discount) : '--')}</td>
        <td>${vigencia}</td>
        <td>${active}</td>
        <td class="right">
          <button class="btn tiny err" data-action="del">&times;</button>
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="7" class="center muted">Sin cupones</td>';

  main.innerHTML = `
    <div class="card">
      <h3>Cupones</h3>
      <div class="pad stack">
        <div class="row" style="flex-wrap:wrap; gap:8px">
          <div style="flex:1">
            <label>Buscar</label>
            <input type="text" id="couponSearch" placeholder="Codigo, descripcion, tipo" value="${this.couponSearch || ''}">
          </div>
          <button class="btn" id="couponApply">Filtrar</button>
        </div>

        <div class="card muted" style="background:#f9fbfb">
          <div class="row" style="flex-wrap:wrap; gap:10px">
            <div>
              <label>Codigo</label>
              <input type="text" id="couponCode" placeholder="ABC123">
            </div>
            <div>
              <label>Tipo</label>
              <select id="couponType">
                <option value="amount">Monto fijo</option>
                <option value="percent">Porcentaje</option>
              </select>
            </div>
            <div>
              <label>Valor</label>
              <input type="number" id="couponValue" min="0" step="0.01" placeholder="0.00">
            </div>
            <div>
              <label>Minimo de compra</label>
              <input type="number" id="couponMin" min="0" step="0.01" placeholder="0.00">
            </div>
            <div>
              <label>Tope de descuento</label>
              <input type="number" id="couponMax" min="0" step="0.01" placeholder="0.00">
            </div>
            <div>
              <label>Inicio</label>
              <input type="date" id="couponStart">
            </div>
            <div>
              <label>Fin</label>
              <input type="date" id="couponEnd">
            </div>
            <div class="row" style="align-items:center; gap:6px">
              <label class="small">Activo</label>
              <input type="checkbox" id="couponActive" checked>
            </div>
            <div style="flex:1; min-width:200px">
              <label>Descripcion</label>
              <input type="text" id="couponDesc" placeholder="Opcional">
            </div>
            <button class="btn" id="couponAdd">Agregar</button>
          </div>
        </div>

        <div style="overflow:auto">
          <table class="table" id="couponTable">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Tipo</th>
                <th>Minimo</th>
                <th>Tope</th>
                <th>Vigencia</th>
                <th>Estado</th>
                <th class="right">Acciones</th>
              </tr>
            </thead>
            <tbody>${rowsHTML}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const applyBtn = Utils.$('#couponApply');
  if (applyBtn) applyBtn.onclick = () => {
    this.couponSearch = Utils.$('#couponSearch').value || '';
    this.renderCoupons();
  };

  const addBtn = Utils.$('#couponAdd');
  if (addBtn) {
    addBtn.onclick = async () => {
      try {
        const code = Utils.cleanTxt(Utils.$('#couponCode').value || '');
        const type = Utils.$('#couponType').value || 'amount';
        const value = Number(Utils.$('#couponValue').value || 0);
        const minPurchase = Number(Utils.$('#couponMin').value || 0);
        const maxDiscount = Number(Utils.$('#couponMax').value || 0);
        const start = Utils.$('#couponStart').value || '';
        const end = Utils.$('#couponEnd').value || '';
        const active = !!Utils.$('#couponActive').checked;
        const desc = Utils.cleanTxt(Utils.$('#couponDesc').value || '');

        if (!code) return Utils.toast('Codigo requerido', 'warn');
        if (value <= 0) return Utils.toast('Valor invalido', 'warn');

        await this.database.put('coupons', {
          id: this.database.uid(),
          code: code.toUpperCase(),
          type,
          value,
          min_purchase: minPurchase,
          max_discount: maxDiscount,
          start_date: start,
          end_date: end,
          active,
          descripcion: desc
        });
        Utils.toast('Cupon guardado', 'ok');
        await this.renderCoupons();
      } catch (error) {
        console.error('Guardar cupon', error);
        Utils.toast('No se pudo guardar', 'err');
      }
    };
  }

  const table = Utils.$('#couponTable');
  if (table) {
    table.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if (!btn) return;
      const tr = btn.closest('tr[data-id]');
      const id = tr ? tr.getAttribute('data-id') : null;
      if (!id) return;
      if (btn.dataset.action === 'del') {
        if (!window.confirm('¿Eliminar cupon?')) return;
        await this.database.delete('coupons', id);
        Utils.toast('Cupon eliminado', 'warn');
        await this.renderCoupons();
      }
    });
  }
};
