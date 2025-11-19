// State management module

class StateManager {
  constructor() {
    this.state = {
      active: 'pos',
      cashier: null,
      pos: {
        customer: null,
        customerPointsUsed: 0,
        coupon: null,
        tipAlloc: [],
        payments: [],
        defaultStylists: [],
        lines: [],
        stylistsGlobal: [],
        tips: 0,
        tipTotal: 0,
        couponApplied: null,
        checkoutLines: []
      }
    };
    
    this._tabs = [
      {id: 'pos', label: 'Punto de venta'},
      {id: 'orders', label: '\u00d3rdenes'},
      {id: 'customers', label: 'Clientes'},
      {id: 'stylists', label: 'Estilistas / Cajeros'},
      {id: 'expenses', label: 'Gastos'},
      {id: 'purchases', label: 'Compras'},
      {id: 'suppliers', label: 'Proveedores'},
      {id: 'payroll', label: 'N\u00f3mina'},
      {id: 'reports', label: 'Reportes'},
      {id: 'settings', label: 'Ajustes / Respaldo'}
    ];
  }

  // Getters
  get activeTab() {
    return this.state.active;
  }

  get pos() {
    return this.state.pos;
  }

  get cashier() {
    return this.state.cashier;
  }

  get tabs() {
    return this._tabs;
  }

  // Setters
  setActiveTab(id) {
    this.state.active = id;
    this.notify('activeTabChanged', id);
  }

  setCashier(cashier) {
    this.state.cashier = cashier;
    this.notify('cashierChanged', cashier);
  }

  updatePos(updates) {
    this.state.pos = Object.assign({}, this.state.pos, updates);
    this.notify('posUpdated', this.state.pos);
  }

  // POS specific methods
  setCustomer(customer) {
    this.state.pos.customer = customer;
    this.notify('customerChanged', customer);
  }

  addLine(line) {
    this.state.pos.lines.push(line);
    this.notify('linesChanged', this.state.pos.lines);
  }

  removeLine(index) {
    this.state.pos.lines.splice(index, 1);
    this.notify('linesChanged', this.state.pos.lines);
  }

  updateLine(index, updates) {
    this.state.pos.lines[index] = Object.assign({}, this.state.pos.lines[index], updates);
    this.notify('linesChanged', this.state.pos.lines);
  }

  clearLines() {
    this.state.pos.lines = [];
    this.notify('linesChanged', this.state.pos.lines);
  }

  setStylistsGlobal(stylists) {
    this.state.pos.stylistsGlobal = stylists;
    this.notify('stylistsChanged', stylists);
  }

  setPayments(payments) {
    this.state.pos.payments = payments;
    this.notify('paymentsChanged', payments);
  }

  setCoupon(coupon) {
    this.state.pos.coupon = coupon;
    this.notify('couponChanged', coupon);
  }

  setTips(tips) {
    this.state.pos.tips = tips;
    this.state.pos.tipTotal = tips;
    this.notify('tipsChanged', tips);
  }

  // Utility methods
  normalizeState() {
    const pos = this.state.pos;
    
    // Global stylists (fuente canonica)
    if (Array.isArray(pos.defaultStylists) && !Array.isArray(pos.stylistsGlobal)) {
      pos.stylistsGlobal = pos.defaultStylists.map(s => ({
        id: s.id, 
        nombre: s.nombre, 
        pct: Number(s.pct || s.porcentaje || 0)
      }));
    }
    
    pos.stylistsGlobal = Array.isArray(pos.stylistsGlobal) 
      ? pos.stylistsGlobal.filter(s => Number(s.pct) > 0) 
      : [];
    
    // Lines
    pos.lines = Array.isArray(pos.lines) 
      ? pos.lines 
      : (Array.isArray(pos.items) ? pos.items : (pos.lines || []));
    
    // Tips canonical
    pos.tips = Number(pos.tips != null ? pos.tips : (pos.tipTotal != null ? pos.tipTotal : 0));
    pos.tipTotal = pos.tips;
    
    // Coupon canonical
    pos.coupon = (pos.coupon || '').toString().trim().toUpperCase();
    
    // Payments canonical
    pos.payments = Array.isArray(pos.payments) ? pos.payments : [];
  }

  // Observer pattern for reactive updates
  listeners = {};

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  notify(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(data));
    }
  }

  // Reset POS state
  resetPos() {
    this.state.pos = {
      customer: null,
      customerPointsUsed: 0,
      coupon: null,
      tipAlloc: [],
      payments: [],
      defaultStylists: [],
      lines: [],
      stylistsGlobal: [],
      tips: 0,
      tipTotal: 0,
      couponApplied: null,
      checkoutLines: []
    };
    this.notify('posReset', this.state.pos);
  }
}

// Global state instance
const stateManager = new StateManager();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StateManager;
} else {
  window.StateManager = StateManager;
  window.stateManager = stateManager;
  // Maintain backward compatibility
  window.state = stateManager.state;
}

