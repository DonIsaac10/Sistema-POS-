// Utility functions module

class Utils {
  // DOM selectors
  static $(sel) {
    return document.querySelector(sel);
  }

  static $$(sel) {
    return Array.from(document.querySelectorAll(sel));
  }

  // Number formatting
  static fmtMoney(n) {
    return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  }

  static money(n) {
    return '$ ' + Number(n || 0).toLocaleString('es-MX', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  // ID generation
  static uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // Date/time utilities
  static nowISO() {
    return new Date().toISOString();
  }

  static pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  static folio() {
    const d = new Date();
    const DD = this.pad(d.getDate()), MM = this.pad(d.getMonth() + 1), YYYY = d.getFullYear();
    const HH = this.pad(d.getHours());
    return `POS-${DD}${MM}${YYYY}-${HH}`;
  }

  static tsName(prefix) {
    const d = new Date();
    const DD = this.pad(d.getDate()), MM = this.pad(d.getMonth() + 1), YYYY = d.getFullYear();
    const HH = this.pad(d.getHours()), mm = this.pad(d.getMinutes());
    return `${prefix}-${DD}${MM}${YYYY}-${HH}${mm}`;
  }

  // File operations
  static downloadFile(filename, content, mime = 'text/plain') {
    const blob = new Blob([content], {type: mime});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // CSV utilities
  static csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    return /[\",\n]/.test(s) ? ('"' + s.replace(/\"/g, '\"\"') + '"') : s;
  }

  static toCSV(headers, rows) {
    const head = headers.join(',') + '\n';
    const body = rows.map(r => headers.map(h => this.csvEscape(r[h])).join(',')).join('\n');
    return head + body + '\n';
  }

  // Math utilities
  static clamp(v, min, max) {
    return Math.min(max, Math.max(min, Number(v || 0)));
  }

  static to2(n) {
    return Number(Number(n || 0).toFixed(2));
  }

  // String utilities
  static cleanTxt(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  static parseMoneyToNumber(s) {
    if (s == null) return 0;
    let t = ('' + s).replace(/[^0-9,.-]/g, '').trim();
    const hasComma = t.includes(',');
    const hasDot = t.includes('.');
    if (hasComma && hasDot) {
      t = t.replace(/,/g, '');
      return Number(t) || 0;
    }
    if (hasComma && !hasDot) {
      t = t.replace(',', '.');
      return Number(t) || 0;
    }
    return Number(t) || 0;
  }

  // UI utilities
  static toast(msg, kind = 'ok') {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.right = '12px';
    el.style.bottom = '12px';
    el.style.background = ({ok: '#111', warn: '#A16207', err: '#7F1D1D'})[kind] || '#111';
    el.style.color = '#fff';
    el.style.padding = '10px 14px';
    el.style.borderRadius = '12px';
    el.style.boxShadow = 'var(--shadow)';
    el.style.zIndex = 200;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  static showModal(title, bodyHTML, options = {}) {
    const {onOk = null, okText = 'Guardar', cancelText = 'Cancelar'} = options;
    const bd = this.$('#modalBackdrop');
    
    bd.innerHTML = `<div class="modal">
      <h3>${title}</h3>
      <div class="pad">${bodyHTML}</div>
      <div class="footer">
        <button class="btn light" id="mCancel">${cancelText}</button>
        ${onOk ? `<button class="btn" id="mOk">${okText}</button>` : ''}
      </div>
    </div>`;
    
    bd.style.display = 'flex';
    this.$('#mCancel').onclick = () => {
      bd.style.display = 'none';
    };
    
    if (onOk) {
      this.$('#mOk').onclick = () => {
        onOk();
        bd.style.display = 'none';
      };
    }
  }

  // Commission utilities
  static commissionRateCap(rate) {
    return this.clamp(rate, 0, 20);
  }

  static sumPct(arr) {
    return this.to2((arr || []).reduce((a, b) => a + Number(b.pct || 0), 0));
  }

  static autoBalance(arr) {
    if (!Array.isArray(arr) || !arr.length) return [];
    let total = this.sumPct(arr);
    
    if (total === 100) return arr;
    if (total <= 0) {
      const eq = this.to2(100 / arr.length);
      return arr.map(s => Object.assign({}, s, {pct: eq}));
    }
    
    // Normalize to 100 keeping proportions
    return arr.map(s => Object.assign({}, s, {
      pct: this.to2((Number(s.pct || 0) / total) * 100)
    }));
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Utils;
} else {
  window.Utils = Utils;
}
