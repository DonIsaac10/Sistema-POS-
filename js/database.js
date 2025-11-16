// Database operations module
const DB_NAME = 'salon_ba_v1';
const DB_VERSION = 1;
const STORES = [
  'settings','cashiers','customers','stylists','products','variants',
  'coupons','pos_orders','pos_lines','pos_tips','payments',
  'expenses','expense_categories','purchases','suppliers','payroll','audit_logs','scheduler'
];

let db = null;

class Database {
  static async open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      
      req.onupgradeneeded = (ev) => {
        const d = ev.target.result;
        STORES.forEach(name => {
          if (!d.objectStoreNames.contains(name)) {
            const os = d.createObjectStore(name, {keyPath: 'id'});
            if (['customers','stylists','suppliers','cashiers'].includes(name)) {
              os.createIndex('by_name', 'nombre', {unique: false});
            }
            if (name === 'customers') {
              os.createIndex('by_phone', 'celular', {unique: true});
            }
            if (name === 'variants') {
              os.createIndex('by_product', 'product_id', {unique: false});
            }
            if (name === 'pos_orders') {
              os.createIndex('by_date', 'fecha_hora', {unique: false});
            }
          }
        });
      };
      
      req.onsuccess = () => {
        db = req.result;
        res(db);
      };
      
      req.onerror = () => rej(req.error);
    });
  }

  static transaction(store, mode = 'readonly') {
    return db.transaction(store, mode).objectStore(store);
  }

  static async getAll(store) {
    return new Promise((res, rej) => {
      const req = this.transaction(store).getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  static async put(store, val) {
    if (!val.id) val.id = this.uid();
    return new Promise((res, rej) => {
      const req = this.transaction(store, 'readwrite').put(val);
      req.onsuccess = () => res(val);
      req.onerror = () => rej(req.error);
    });
  }

  static async delete(store, id) {
    return new Promise((res, rej) => {
      const req = this.transaction(store, 'readwrite').delete(id);
      req.onsuccess = () => res(true);
      req.onerror = () => rej(req.error);
    });
  }

  static async getById(store, id) {
    return new Promise((res, rej) => {
      const req = this.transaction(store).get(id);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  static async queryIndex(store, idx, key) {
    return new Promise((res, rej) => {
      const i = this.transaction(store).index(idx);
      const req = i.getAll(key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  static uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  static async seed() {
    const s = await this.getAll('settings');
    if (s.length === 0) {
      await this.put('settings', {
        id: 'main', 
        loyalty_rate: 0.02, 
        colores: {teal: '#2E9593', rose: '#746362'}, 
        salon: 'The beauty salón by alan', 
        firma: 'programa desarrollado por contacto@gammaconsultores.mx', 
        payment_methods: ['Efectivo','Tarjeta','Transferencia']
      });
      
      await this.put('expense_categories', {id: this.uid(), nombre: 'Renta'});
      await this.put('expense_categories', {id: this.uid(), nombre: 'Servicios'});
      await this.put('expense_categories', {id: this.uid(), nombre: 'Publicidad'});
      
      const prod1 = await this.put('products', {
        id: this.uid(), 
        nombre: 'Cortes', 
        tipo: 'Servicio', 
        categoria: 'Cortes', 
        img: 'file:///C:/Users/misag/OneDrive/Desktop/Imagenes%20TBS/cortes.jpg'
      });
      
      const cortes = [['Dama con Alan',580],['Dama General',470],['Caballero con Alan',350],['Caballero General',300],['Niña',470]];
      for (const [n,p] of cortes) {
        await this.put('variants', {
          id: this.uid(), 
          product_id: prod1.id, 
          nombre: n, 
          precio: Number(p)
        });
      }
      
      const prod2 = await this.put('products', {
        id: this.uid(), 
        nombre: 'Tinte', 
        tipo: 'Servicio', 
        categoria: 'Color', 
        img: 'file:///C:/Users/misag/OneDrive/Desktop/Imagenes%20TBS/tinte.jpg'
      });
      
      const tinte = [['Retoque de raíz',700],['Corto',990],['Mediano',1100],['Largo',1220],['Muy largo',1340],['Extra largo',1570],['Extra largo abundante',1690]];
      for (const [n,p] of tinte) {
        await this.put('variants', {
          id: this.uid(), 
          product_id: prod2.id, 
          nombre: n, 
          precio: Number(p)
        });
      }
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Database;
} else {
  window.Database = Database;
}
