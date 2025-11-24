// UI components module

class UIComponents {
  // Navigation
  static renderNav(activeTab, tabs, onTabChange) {
    const nav = Utils.$('#nav');
    if (!nav) return;
    nav.innerHTML = '';

    if (!Array.isArray(tabs) || !tabs.length) {
      console.warn('UIComponents.renderNav: lista de pesta\\u00f1as no disponible');
      return;
    }
    
    tabs.forEach(tab => {
      const button = document.createElement('button');
      button.textContent = tab.label;
      if (tab.id === activeTab) {
        button.classList.add('active');
      }
      button.onclick = () => onTabChange(tab.id);
      nav.appendChild(button);
    });
  }

  // Header
  static renderHeader(salonName, firma) {
    const brand = Utils.$('.brand');
    if (!brand) return;

    brand.innerHTML = `
      <div class="logo fallback" id="appLogo">BA</div>
      <div>
        <div class="title">${salonName}</div>
        <div class="muted small">programa desarrollado por <b>${firma}</b></div>
      </div>
    `;
  }

  // Footer
  static renderFooter(firma) {
    const year = new Date().getFullYear();
    const signature = Utils.$('.signature');
    if (signature) {
      signature.innerHTML = `&copy; ${year} The Beauty Salon by Alan &mdash; <span style="color:var(--rose)">${firma}</span>`;
    }
  }

  // Product catalog
  static renderCatalog(products, variants, onProductSelect) {
    const catalog = Utils.$('#catalog');
    if (!catalog) return '';

    let html = '';
    products.forEach(product => {
      const productVariants = variants.filter(v => v.product_id === product.id);
      
      html += `
        <div class="tile">
          ${product.img ? `<img src="${product.img}" alt="${product.nombre}">` : '<img src="" alt="">'}
          <div class="pad">
            <h4>${product.nombre}</h4>
            <div class="chips">
              ${productVariants.map(variant => `
                <div class="chip" data-variant-id="${variant.id}" onclick="selectVariant('${variant.id}')">
                  <span>${variant.nombre}</span>
                  <b>${Utils.money(variant.precio)}</b>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    });

    if (catalog) {
      catalog.innerHTML = html;
    }
    
    return html;
  }

  // Customer selector
  static renderCustomerSelector(customers, selectedCustomer, onCustomerSelect) {
    let html = '<div class="chips">';
    
    customers.forEach(customer => {
      const isSelected = selectedCustomer && selectedCustomer.id === customer.id;
      html += `
        <div class="chip ${isSelected ? 'selected' : ''}" data-customer-id="${customer.id}" onclick="selectCustomer('${customer.id}')">
          <span>${customer.nombre}</span>
          <b>${customer.celular}</b>
        </div>
      `;
    });
    
    html += '</div>';
    return html;
  }

  // Stylist selector
  static renderStylistSelector(stylists, selectedStylists, onStylistToggle) {
    let html = '<div class="chips">';
    
    stylists.forEach(stylist => {
      const isSelected = selectedStylists.some(s => s.id === stylist.id);
      html += `
        <div class="chip inline ${isSelected ? 'selected' : ''}" data-stylist-id="${stylist.id}" onclick="toggleStylist('${stylist.id}')">
          <span>${stylist.nombre}</span>
          <b>${stylist.pct || 0}%</b>
        </div>
      `;
    });
    
    html += '</div>';
    return html;
  }

  // Ticket lines
  static renderTicketLines(lines, onLineUpdate, onLineRemove) {
    let html = '';
    
    lines.forEach((line, index) => {
      const base = Number((line.variant && line.variant.precio) || 0) * Number(line.qty || 1);
      const discount = Number(line.discount || 0);
      const adjust = line.manualAdjust 
        ? (line.manualAdjust.sign === '+' ? Number(line.manualAdjust.monto || 0) : -Number(line.manualAdjust.monto || 0))
        : 0;
      const total = Math.max(0, base - discount + adjust);
      const cap = Number(UIComponents.commissionCap || 20);
      const comm = (line.stylists || []).reduce((sum, st) => {
        const pct = Math.min(Number(st.pct || 0), cap);
        return sum + (total * (pct / 100));
      }, 0);

      html += `
        <div class="line" data-line-index="${index}">
          <div>
            <strong>${(line.variant && line.variant.nombre) || 'Producto'}</strong>
            ${line.qty > 1 ? `<span class="muted">x${line.qty}</span>` : ''}
            ${line.stylists && line.stylists.length > 0 ? `
              <div class="muted small">Estilistas: ${line.stylists.map(s => s.nombre).join(', ')}</div>
            ` : ''}
          </div>
          <div class="meta">
            <div>Base: ${Utils.money(base)}</div>
            ${discount > 0 ? `<div>Desc: ${Utils.money(discount)}</div>` : ''}
            ${adjust !== 0 ? `<div>Ajuste: ${Utils.money(adjust)}</div>` : ''}
            <div><strong>${Utils.money(total)}</strong></div>
            ${comm > 0 ? `<div class="small muted">Comisi\u00f3n estilistas: ${Utils.money(comm)}</div>` : ''}
          </div>
          <div class="actions">
            <button class="btn tiny" onclick="editLine(${index})">Estilista</button>
            <button class="btn tiny err" onclick="removeLine(${index})">&times;</button>
          </div>
        </div>
      `;
    });

    return html;
  }

  // Totals display
  static renderTotals(totals) {
    return `
      <div class="totals">
        <div>Subtotal</div>
        <div><b>${Utils.money(totals.subtotal || 0)}</b></div>
        
        ${totals.couponCut > 0 ? `
          <div>Cup\u00f3n</div>
          <div><b>-${Utils.money(totals.couponCut)}</b></div>
        ` : ''}
        
        ${totals.pointsUse > 0 ? `
          <div>Puntos</div>
          <div><b>-${Utils.money(totals.pointsUse)}</b></div>
        ` : ''}
        ${totals.globalDiscount > 0 ? `
          <div>Descuento global</div>
          <div><b>-${totals.globalDiscountType === 'percent' ? totals.globalDiscount + '%' : Utils.money(totals.globalDiscount)}</b></div>
        ` : ''}
        
        ${totals.tipTotal > 0 ? `
          <div>Propina</div>
          <div><b>${Utils.money(totals.tipTotal)}</b></div>
        ` : ''}

        ${totals.commissionTotal > 0 ? `
          <div>Comisi\u00f3n estilistas</div>
          <div><b>${Utils.money(totals.commissionTotal)}</b></div>
        ` : ''}
        
        <div><strong>TOTAL</strong></div>
        <div><b>${Utils.money(totals.total || 0)}</b></div>
      </div>
    `;
  }

  // Payment methods
  static renderPaymentMethods(config) {
    if (!config) return '';

    const {
      methods = [],
      mode = 'single',
      singleMethod,
      singleAmount,
      mixMethod1,
      mixMethod2,
      mixAmount1,
      mixAmount2,
      payments = [],
      total = 0,
      paid = 0,
      outstanding = 0
    } = config;

    const methodOptions = methods.map(method => `
      <option value="${method}" ${(mode === 'single' && singleMethod === method) ? 'selected' : ''}>
        ${method}
      </option>
    `).join('');

    const mixOptions = (selected) => methods.map(method => `
      <option value="${method}" ${selected === method ? 'selected' : ''}>${method}</option>
    `).join('');

    const summary = payments.length
      ? payments.map(p => `
          <div class="totals">
            <div>${p.metodo}</div>
            <div><b>${Utils.money(p.monto)}</b></div>
          </div>
        `).join('')
      : '<div class="muted small">Sin pagos registrados</div>';

    return `
      <div class="paybox">
        <label>Forma de pago</label>
        <select id="paymentType">
          ${methodOptions}
          <option value="Mixto" ${mode === 'mixed' ? 'selected' : ''}>Mixto</option>
        </select>
      </div>

      <div id="singleSection" class="${mode === 'single' ? '' : 'hidden'}">
        <label>Monto</label>
        <input type="number" id="singleAmount" min="0" step="0.01" value="${Number(singleAmount || 0).toFixed(2)}">
        <div class="row" style="margin-top:8px">
          <button class="btn light" id="singleFill">Usar total (${Utils.money(total)})</button>
          <button class="btn" id="applySingle">Registrar pago</button>
        </div>
      </div>

      <div id="mixedSection" class="${mode === 'mixed' ? '' : 'hidden'}">
        <div class="row">
          <div>
            <label>Metodo 1</label>
            <select id="mixMethod1">${mixOptions(mixMethod1)}</select>
          </div>
          <div>
            <label>Monto 1</label>
            <input type="number" id="mixAmount1" min="0" step="0.01" value="${Number(mixAmount1 || 0).toFixed(2)}">
          </div>
        </div>
        <div class="row">
          <div>
            <label>Metodo 2</label>
            <select id="mixMethod2">${mixOptions(mixMethod2)}</select>
          </div>
          <div>
            <label>Monto 2</label>
            <input type="number" id="mixAmount2" min="0" step="0.01" value="${Number(mixAmount2 || 0).toFixed(2)}">
          </div>
        </div>
        <div class="row" style="margin-top:8px">
          <button class="btn light" id="splitEven">Repartir total</button>
          <button class="btn" id="applyMixed">Registrar pagos</button>
        </div>
      </div>

      <div class="card" style="margin-top:12px">
        <div class="pad">
          <h4 style="margin-top:0">Pagos registrados</h4>
          ${summary}
          <div class="row" style="justify-content:space-between;margin-top:12px">
            <div class="${outstanding > 0 ? 'muted' : 'success'} small">
              ${outstanding > 0 ? `Restante: ${Utils.money(outstanding)}` : `Pagado: ${Utils.money(paid)}`}
            </div>
            <button class="btn light tiny" id="clearPayments"${payments.length ? '' : ' disabled'}>Limpiar</button>
          </div>
        </div>
      </div>
    `;
  }


  // Orders table
  static renderOrdersTable(orders, onOrderSelect) {
    let html = `
      <table class="table">
        <thead>
          <tr>
            <th>Folio</th>
            <th>Fecha</th>
            <th>Cliente</th>
            <th>Total</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
    `;

    orders.forEach(order => {
      html += `
        <tr data-order-id="${order.id}">
          <td>${order.folio || 'N/A'}</td>
          <td>${new Date(order.fecha_hora).toLocaleDateString()}</td>
          <td>${(order.customer && order.customer.nombre) || 'Cliente general'}</td>
          <td>${Utils.money(order.total || 0)}</td>
          <td>
            <button class="btn tiny" onclick="viewOrder('${order.id}')">Ver</button>
            <button class="btn tiny" onclick="printOrder('${order.id}')">Imprimir</button>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    return html;
  }

  // Modal for commissions
  static renderCommissionModal(commissionsData, onExport) {
    const rows = Object.values(commissionsData).map(v => 
      `<tr>
        <td>${v.nombre}</td>
        <td class="right">${Utils.money(v.rate)}%</td>
        <td class="right">${Utils.money(v.total || 0)}</td>
      </tr>`
    ).join('') || '<tr><td colspan="3" class="right muted">Sin datos</td></tr>';

    return `
      <div class="modal-card">
        <div class="pad">
          <h3>Comisiones por estilista</h3>
          <table class="table">
            <thead>
              <tr>
                <th>Estilista</th>
                <th class="right">% comisi\u00f3n (cap 20%)</th>
                <th class="right">Comisi\u00f3n</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="row" style="justify-content:space-between;gap:8px;margin-top:8px">
            <button class="btn light" onclick="closeCommissionModal()">Cerrar</button>
            <button class="btn" onclick="exportCommissions()">Exportar CSV</button>
          </div>
        </div>
      </div>
    `;
  }

  // Loading indicator
  static showLoading(message = 'Cargando...') {
    const loading = document.createElement('div');
    loading.id = 'loadingIndicator';
    loading.className = 'modal-backdrop';
    loading.style.display = 'flex';
    loading.innerHTML = `
      <div class="modal">
        <div class="pad center">
          <div class="muted">${message}</div>
        </div>
      </div>
    `;
    document.body.appendChild(loading);
  }

  static hideLoading() {
    const loading = Utils.$('#loadingIndicator');
    if (loading) {
      loading.remove();
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIComponents;
} else {
  window.UIComponents = UIComponents;
}

