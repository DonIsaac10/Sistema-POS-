// UI components module

class UIComponents {
  // Navigation
  static renderNav(activeTab, tabs, onTabChange) {
    const nav = Utils.$('#nav');
    nav.innerHTML = '';
    
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
        <div class="title">${salonName} — Sistema de Gestión (V1)</div>
        <div class="muted small">programa desarrollado por <b>${firma}</b></div>
      </div>
    `;
  }

  // Footer
  static renderFooter(firma) {
    const year = new Date().getFullYear();
    const signature = Utils.$('.signature');
    if (signature) {
      signature.innerHTML = `© ${year} The beauty salón by alan — <span style="color:var(--rose)">programa desarrollado por ${firma}</span>`;
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
        <div class="chip ${isSelected ? 'selected' : ''}" data-stylist-id="${stylist.id}" onclick="toggleStylist('${stylist.id}')">
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
      const base = Number(line.variant?.precio || 0) * Number(line.qty || 1);
      const discount = Number(line.discount || 0);
      const adjust = line.manualAdjust 
        ? (line.manualAdjust.sign === '+' ? Number(line.manualAdjust.monto || 0) : -Number(line.manualAdjust.monto || 0))
        : 0;
      const total = Math.max(0, base - discount + adjust);

      html += `
        <div class="line" data-line-index="${index}">
          <div>
            <strong>${line.variant?.nombre || 'Producto'}</strong>
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
          </div>
          <div class="actions">
            <button class="btn tiny" onclick="editLine(${index})">Editar</button>
            <button class="btn tiny err" onclick="removeLine(${index})">×</button>
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
          <div>Cupón</div>
          <div><b>-${Utils.money(totals.couponCut)}</b></div>
        ` : ''}
        
        ${totals.pointsUse > 0 ? `
          <div>Puntos</div>
          <div><b>-${Utils.money(totals.pointsUse)}</b></div>
        ` : ''}
        
        <div>IVA (${(totals.ivaRate || 0.16) * 100}%)</div>
        <div><b>${Utils.money(totals.iva || 0)}</b></div>
        
        ${totals.tipTotal > 0 ? `
          <div>Propina</div>
          <div><b>${Utils.money(totals.tipTotal)}</b></div>
        ` : ''}
        
        <div><strong>TOTAL</strong></div>
        <div><b>${Utils.money(totals.total || 0)}</b></div>
      </div>
    `;
  }

  // Payment methods
  static renderPaymentMethods(paymentMethods, selectedMethod, onMethodChange) {
    let html = '<select id="paymentType">';
    
    paymentMethods.forEach(method => {
      html += `<option value="${method}" ${selectedMethod === method ? 'selected' : ''}>${method}</option>`;
    });
    
    html += '<option value="Mixto">Mixto</option></select>';
    return html;
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
          <td>${order.customer?.nombre || 'Cliente general'}</td>
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
                <th class="right">% comisión (cap 20%)</th>
                <th class="right">Comisión</th>
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
