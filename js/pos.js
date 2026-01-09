// POS logic module

class POSLogic {
  constructor(stateManager, database) {
    this.state = stateManager;
    this.db = database;
  }

  // Calculate totals for current ticket
  async calcTotals() {
    this.state.normalizeState();
    const settings = await this.db.getById('settings', 'main');
    
    let subtotal = 0;
    let hasLineDiscount = false;
    let commissionTotal = 0;
    const pos = this.state.pos;
    const commissionCap = Number((settings && settings.commission_cap) || 20);
    
    // Calculate line totals
    const lines = pos.lines.map(l => {
      const base = Number((l.variant && l.variant.precio) || 0) * Number(l.qty || 1);
      const disc = Number(l.discount || 0);
      const adj = l.manualAdjust 
        ? (l.manualAdjust.sign === '+' ? Number(l.manualAdjust.monto || 0) : -Number(l.manualAdjust.monto || 0))
        : 0;
      const total = Math.max(0, base - disc + adj);
      
      if (disc > 0) hasLineDiscount = true;
      // Commission per line: sum of stylist pct, capped at configured max
      const lineComm = (l.stylists || []).reduce((sum, st) => {
        const pct = Math.min(Number(st.pct || 0), commissionCap);
        return sum + (total * (pct / 100));
      }, 0);
      commissionTotal += lineComm;
      return Object.assign({}, l, {base: base, lineTotal: Number(Utils.fmtMoney(total))});
    });
    
    subtotal = lines.reduce((a, b) => a + b.lineTotal, 0);

    // Handle coupon
    const coupon = pos.coupon;
    let couponCut = 0;
    let couponValid = false;
    
    if (coupon) {
      try {
        const list = await this.db.getAll('coupons');
        const c = (list || []).find(x => (x.code || '').toUpperCase() === coupon && x.active);
        
        if (c) {
          const today = new Date().toISOString().slice(0, 10);
          const inVig = (!c.start_date || c.start_date <= today) && (!c.end_date || c.end_date >= today);
          const preBase = Math.max(0, Number(subtotal || 0) - Number(pos.customerPointsUsed || 0));
          
          if (inVig && preBase >= Number(c.min_purchase || 0)) {
            let cut = 0;
            if (c.type === 'percent') {
              cut = preBase * (Number(c.value || 0) / 100);
              const cap = Number(c.max_discount || 0);
              if (cap > 0) cut = Math.min(cut, cap);
            } else {
              cut = Number(c.value || 0);
            }
            couponCut = Number(Math.min(cut, preBase).toFixed(2));
            couponValid = true;
            pos.couponApplied = c;
          } else {
            couponCut = 0;
            couponValid = false;
            pos.couponApplied = null;
          }
        } else {
          couponCut = 0;
          pos.couponApplied = null;
        }
      } catch (e) {
        console.warn('Coupon validation error', e);
      }
    }

    // Handle loyalty points
    if (settings && settings.prices_include_tax === undefined) {
      settings.prices_include_tax = true;
    }
    
    const loyalty = (settings && settings.loyalty_rate) || 0.02;
    let accrueBase = subtotal;
    if (coupon || hasLineDiscount) accrueBase = 0;
    const pointsEarned = Number(Utils.fmtMoney(accrueBase * loyalty));
    
    let pointsUse = Number(pos.customerPointsUsed || 0);
    const customer = pos.customer;
    const maxPoints = Math.min(Number((customer && customer.puntos) || 0), Math.max(0, subtotal - couponCut));
    
    if (pointsUse > maxPoints) pointsUse = maxPoints;
    pos.customerPointsUsed = pointsUse;

    // Handle tips
    const tipTotal = pos.tipAlloc.reduce((a, b) => a + Number(b.monto || 0), 0);
    pos.tips = tipTotal;
    pos.tipTotal = tipTotal;

    // Enforce tips rule: require at least one stylist to accept tips
    if (!Array.isArray(pos.stylistsGlobal) || !pos.stylistsGlobal.length) {
      pos.tips = 0;
      pos.tipTotal = 0;
      pos._tipBlocked = true;
    }

    // Calculate IVA
    const ivaRate = Number((settings && settings.iva_rate) != null ? settings.iva_rate : 0.16);
    // Global discount
    const globalDiscount = Number(pos.globalDiscount || 0);
    const globalType = pos.globalDiscountType || 'amount';
    let taxBase = Math.max(0, Number(subtotal || 0) - Number(couponCut || 0) - Number(pointsUse || 0));
    if (globalDiscount > 0) {
      if (globalType === 'percent') {
        taxBase = Math.max(0, taxBase - (taxBase * (globalDiscount / 100)));
      } else {
        taxBase = Math.max(0, taxBase - globalDiscount);
      }
    }
    const netBase = taxBase / (1 + ivaRate);
    const iva = Number((taxBase - netBase).toFixed(2));

    // Final total (precios incluyen IVA)
    const total = Number((taxBase + Number(tipTotal || 0)).toFixed(2));

    return {
      subtotal,
      couponCut,
      couponValid,
      pointsUse,
      pointsEarned,
      tipTotal,
      iva,
      ivaRate,
      total,
      commissionTotal,
      globalDiscount,
      globalDiscountType: pos.globalDiscountType,
      _tipBlocked: pos._tipBlocked
    };
  }

  // Add product variant to ticket
  async addVariant(variantId, qty = 1) {
    try {
      const variant = await this.db.getById('variants', variantId);
      if (!variant) {
        Utils.toast('Producto no encontrado', 'err');
        return false;
      }

      const line = {
        id: Utils.uid(),
        variant_id: variant.id,
        variant,
        qty: Number(qty) || 1,
        discount: 0,
        stylists: [],
        manualAdjust: null
      };

      this.state.addLine(line);
      return true;
    } catch (error) {
      console.error('Error adding variant', error);
      Utils.toast('No se pudo agregar el producto', 'err');
      return false;
    }
  }

  // Remove line from ticket
  removeLine(lineIndex) {
    this.state.removeLine(lineIndex);
  }

  // Update line quantity
  updateLineQty(lineIndex, qty) {
    if (qty <= 0) {
      this.removeLine(lineIndex);
    } else {
      this.state.updateLine(lineIndex, {qty: Number(qty)});
    }
  }

  // Apply discount to line
  applyLineDiscount(lineIndex, discount) {
    this.state.updateLine(lineIndex, {discount: Number(discount)});
  }

  // Apply manual adjustment to line
  applyLineAdjustment(lineIndex, amount, sign) {
    this.state.updateLine(lineIndex, {
      manualAdjust: (amount > 0 ? {monto: Number(amount), sign: sign} : null)
    });
  }

  // Set customer
  async setCustomer(customerId) {
    if (!customerId) {
      this.state.setCustomer(null);
      return;
    }

    const customer = await this.db.getById('customers', customerId);
    this.state.setCustomer(customer);
  }

  // Search customers by phone
  async searchCustomersByPhone(phone) {
    try {
      return await this.db.queryIndex('customers', 'by_phone', phone);
    } catch (e) {
      return [];
    }
  }

  // Search customers by name
  async searchCustomersByName(name) {
    const customers = await this.db.getAll('customers');
    return customers.filter(c => 
      c.nombre.toLowerCase().includes(name.toLowerCase())
    );
  }

  // Apply coupon
  async applyCoupon(code) {
    const upperCode = (code || '').toString().trim().toUpperCase();
    this.state.setCoupon(upperCode);
    return await this.calcTotals();
  }

  // Set customer points to use
  setCustomerPointsUsed(points) {
    this.state.updatePos({customerPointsUsed: Number(points)});
  }

  // Add tip allocation
  addTipAllocation(stylistId, amount) {
    const pos = this.state.pos;
    const existing = pos.tipAlloc.find(t => t.stylist_id === stylistId);
    
    if (existing) {
      existing.monto = Number(amount);
    } else {
      pos.tipAlloc.push({
        id: Utils.uid(),
        stylist_id: stylistId,
        monto: Number(amount)
      });
    }
    
    this.state.updatePos({tipAlloc: pos.tipAlloc});
  }

  // Remove tip allocation
  removeTipAllocation(stylistId) {
    const pos = this.state.pos;
    pos.tipAlloc = pos.tipAlloc.filter(t => t.stylist_id !== stylistId);
    this.state.updatePos({tipAlloc: pos.tipAlloc});
  }

  // Validate and set payments
  async validatePayments(paymentType, amounts) {
    const totals = await this.calcTotals();
    const total = Number(totals.total || 0);
    const pos = this.state.pos;

    if (paymentType !== 'Mixto') {
      const amount = Utils.clamp(amounts.single, 0, total);
      pos.payments = amount > 0 ? [{
        id: Utils.uid(),
        metodo: paymentType,
        monto: Utils.to2(amount)
      }] : [];
    } else {
      let a1 = Utils.clamp(amounts.mix1, 0, total);
      let a2 = Utils.clamp(amounts.mix2, 0, total);

      // Adjust to not exceed total
      if (a1 + a2 > total) {
        a2 = Utils.to2(total - a1);
      }

      pos.payments = [];
      if (a1 > 0) {
        pos.payments.push({
          id: Utils.uid(),
          metodo: amounts.method1,
          monto: Utils.to2(a1)
        });
      }
      if (a2 > 0) {
        pos.payments.push({
          id: Utils.uid(),
          metodo: amounts.method2,
          monto: Utils.to2(a2)
        });
      }
    }

    this.state.setPayments(pos.payments);
    return pos.payments;
  }

  // Close ticket and save order
  async closeTicket() {
    const totals = await this.calcTotals();
    const pos = this.state.pos;

    if (!pos.payments.length) {
      throw new Error('No hay pagos registrados');
    }

    const order = {
      id: Utils.uid(),
      folio: Utils.folio(),
      fecha_hora: Utils.nowISO(),
      customer_id: (pos.customer && pos.customer.id) || null,
      customer: pos.customer,
      subtotal: totals.subtotal,
      couponCut: totals.couponCut,
      pointsUse: totals.pointsUse,
      pointsEarned: totals.pointsEarned,
      iva: totals.iva,
      tipTotal: totals.tipTotal,
      commissionTotal: totals.commissionTotal,
      total: totals.total,
      payments: pos.payments,
      stylistsGlobal: pos.stylistsGlobal,
      tipAlloc: pos.tipAlloc,
      cashier_id: (this.state.cashier && this.state.cashier.id) || null
    };

    // Save order
    await this.db.put('pos_orders', order);

    // Fetch settings for commission cap
    const settings = await this.db.getById('settings', 'main');
    const commissionCap = Number((settings && settings.commission_cap) || 20);

    // Save lines with computed totals (ensures commissions are calculated)
    for (const line of pos.lines) {
      const base = Number((line.variant && line.variant.precio) || 0) * Number(line.qty || 1);
      const disc = Number(line.discount || 0);
      const adj = line.manualAdjust
        ? (line.manualAdjust.sign === '+' ? Number(line.manualAdjust.monto || 0) : -Number(line.manualAdjust.monto || 0))
        : 0;
      const lineTotal = Math.max(0, base - disc + adj);

      const lineComm = (line.stylists || []).reduce((sum, st) => {
        const pct = Math.min(Number(st.pct || 0), commissionCap);
        return sum + (lineTotal * (pct / 100));
      }, 0);

      await this.db.put('pos_lines', {
        id: Utils.uid(),
        order_id: order.id,
        variant_id: line.variant_id,
        variant: line.variant,
        qty: line.qty,
        discount: line.discount,
        manualAdjust: line.manualAdjust,
        stylists: line.stylists,
        price: (line.variant && line.variant.precio) || 0,
        base: base,
        lineTotal: Number(Utils.fmtMoney(lineTotal)),
        commission: lineComm
      });

      // Comisiones se calculan desde pos_lines para n�mina,
      // no se guardan como registros individuales.
    }

    // Save tips if any
    if (pos.tipAlloc.length > 0) {
      for (const tip of pos.tipAlloc) {
        await this.db.put('pos_tips', {
          id: tip.id,
          order_id: order.id,
          stylist_id: tip.stylist_id,
          monto: tip.monto,
          fecha_hora: Utils.nowISO()
        });
      }
    }

    // Update customer points if applicable
    if (pos.customer && totals.pointsEarned > 0) {
      const customer = await this.db.getById('customers', pos.customer.id);
      if (customer) {
        customer.puntos = Number(customer.puntos || 0) + totals.pointsEarned;
        await this.db.put('customers', customer);
      }
    }

    return order;
  }

  // Reset POS state
  resetPOS() {
    this.state.resetPos();
  }

  // Snapshot ticket lines for printing/export
  snapshotTicketLines() {
    try {
      const scope = Utils.$('#pos') || document;
      const allElems = Array.from(scope.querySelectorAll('.ticket *'));
      const raw = [];

      // Find elements with "Base $"
      allElems.forEach(el => {
        const txt = Utils.cleanTxt(el.textContent || '');
        if (!/(^|\s)Base\s*\$?\s*[0-9.,]+/i.test(txt)) return;
        
        const card = el.closest('.card, .line, [data-line], .ticket-item, .pos-line, .line-item, .linea, .renglon') || el;
        raw.push(card);
      });

      // Filter out containers
      const candidates = [];
      const seenEls = new Set();
      
      raw.forEach(card => {
        if (!card || seenEls.has(card)) return;
        const txt = Utils.cleanTxt(card.innerText || '');
        const countBase = (txt.match(/(^|\s)Base\s*\$?\s*[0-9.,]+/gi) || []).length;
        
        // Reject if multiple "Base" (container with several cards)
        if (countBase !== 1) return;
        
        // Reject if contains summary keywords
        if (/\b(Subtotal|Cup[o\u00f3]n|Puntos|TOTAL|Tipo de pago|Propinas|Cerrar ticket|Monto|Efectivo|Tarjeta|Transferencia|Mixto)\b/i.test(txt)) return;
        
        // Reject if first line is "Ticket"
        const first = Utils.cleanTxt((txt.split(/\r?\n/)[0] || ''));
        if (/^Ticket$/i.test(first)) return;
        
        candidates.push(card);
        seenEls.add(card);
      });

      // Build lines
      const lines = [];
      candidates.forEach(el => {
        const text = Utils.cleanTxt(el.innerText || '');
        if (!text) return;

        // Extract title
        let title = '';
        const titleEl = el.querySelector('h1,h2,h3,h4,h5,strong,.title,.titulo,.nombre');
        if (titleEl) title = Utils.cleanTxt(titleEl.textContent);
        
        if (!title) {
          const idx = text.indexOf('Base ');
          title = idx > 0 ? Utils.cleanTxt(text.slice(0, idx)) : Utils.cleanTxt(text.split(/[\r\n]/)[0]);
        }
        
        title = title.replace(/\s+x\d+\s*$/i, '').replace(/\s+Estilistas?:.*$/i, '').trim();

        // Extract quantity
        let qty = 1;
        const mQty = text.match(/\bx\s*(\d{1,3})\b/i);
        if (mQty) qty = Number(mQty[1]) || 1;

        // Extract unit price
        let unit = 0;
        const mBase = text.match(/Base\s*\$?\s*([0-9\.,]+)/i);
        if (mBase) unit = Utils.parseMoneyToNumber(mBase[1]);

        // Extract adjustment
        let adjust = 0;
        const mAdj = text.match(/Ajuste\s*\$?\s*([0-9\.,\-\+]+)/i);
        if (mAdj) adjust = Utils.parseMoneyToNumber(mAdj[1]);

        // Extract stylists note
        let stylistsNote = '';
        const mSty = text.match(/Estilistas?:\s*(.+)$/i);
        if (mSty) stylistsNote = Utils.cleanTxt(mSty[1]);

        if (!title && unit <= 0) return;
        lines.push({ 
          name: title || '\u2014', 
          qty, 
          unit, 
          adjust, 
          stylistsNote 
        });
      });

      this.state.updatePos({checkoutLines: lines});
      return lines;
    } catch (e) {
      console.warn('snapshotTicketLines error', e);
      return [];
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = POSLogic;
} else {
  window.POSLogic = POSLogic;
}
