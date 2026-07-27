/**
 * GFC Premium Manager - Samsung Life GFC Planner System
 * Features: Manual Club Tier Selection, Senior Performance Bonuses, 
 * New Planner Support, Multi-promotions, 16th month surrender values, 
 * and Employment Insurance deductions.
 */

// --- AuthService: 인증 관련 로직 분리 ---
class AuthService {
  static async checkAuth() {
    try {
      const { data: { user } } = await window.supabase.auth.getUser();
      return user;
    } catch (e) {
      console.error('Auth check error:', e);
      return null;
    }
  }

  static async login(email, password) {
    if (!window.supabase) throw new Error('Supabase가 초기화되지 않았습니다.');
    const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  static async logout() {
    await window.supabase.auth.signOut();
  }
}

// --- ContractService: 데이터베이스 연동 로직 분리 ---
class ContractService {
  static async getContracts() {
    const user = await AuthService.checkAuth();
    if (!user) return [];
    
    const { data, error } = await window.supabase
      .from('contracts')
      .select('*')
      .eq('user_id', user.id);
    if (error) throw error;
    return data || [];
  }

  static async addContract(contract) {
    const user = await AuthService.checkAuth();
    if (!user) throw new Error('로그인이 필요합니다.');
    
    contract.id = 'GFC*' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    contract.createdAt = new Date().toISOString();
    
    const { data, error } = await window.supabase
      .from('contracts')
      .insert([{ ...contract, user_id: user.id }])
      .select();
    
    if (error) throw error;
    return data[0];
  }

  static async updateContract(contract) {
    const user = await AuthService.checkAuth();
    if (!user) throw new Error('로그인이 필요합니다.');
    
    const { data, error } = await window.supabase
      .from('contracts')
      .update({ ...contract })
      .eq('id', contract.id)
      .eq('user_id', user.id)
      .select();
    
    if (error) throw error;
    return data[0];
  }

  static async deleteContract(id) {
    const user = await AuthService.checkAuth();
    if (!user) throw new Error('로그인이 필요합니다.');
    
    const { error } = await window.supabase
      .from('contracts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    
    if (error) throw error;
  }
}

// --- LocalStorageStore: 로컬 데이터 관리 ---
class LocalStorageStore {
  static STORAGE_KEY = 'gfc_premium_manager_v5';

  static getContracts() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) { return []; }
  }

  static saveContracts(contracts) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(contracts));
  }

  static getSettings() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY + '_settings');
      return data ? JSON.parse(data) : { joinDate: '2025-01', clubTier: 'club_350' };
    } catch (e) { return { joinDate: '2025-01', clubTier: 'club_350' }; }
  }

  static saveSettings(settings) {
    localStorage.setItem(this.STORAGE_KEY + '_settings', JSON.stringify(settings));
  }
}

// --- GFC Advanced Financial Engine ---
class GfcAdvancedEngine {
  static calculateTenureMonth(joinDateStr, targetDate = new Date()) {
    if (!joinDateStr) return 1;
    const [jYear, jMonth] = joinDateStr.split('-').map(Number);
    const tYear = targetDate.getFullYear();
    const tMonth = targetDate.getMonth() + 1;
    const diffMonths = (tYear - jYear) * 12 + (tMonth - jMonth) + 1;
    return Math.max(1, diffMonths);
  }

  static getClubBonusParams(clubTierKey) {
    switch (clubTierKey) {
      case 'consultant': return { name: '일반 컨설턴트 (무 Club)', rate: 0.40 };
      case 'club_30': return { name: '30 만 Club', rate: 0.45 };
      case 'club_50': return { name: '50 만 Club', rate: 0.50 };
      case 'club_70': return { name: '70 만 Club', rate: 0.60 };
      case 'club_100': return { name: '100 만 Club', rate: 0.65 };
      case 'club_150': return { name: '150 만 Club', rate: 0.75 };
      case 'club_230': return { name: '명인 Club', rate: 0.90 };
      case 'club_350': default: return { name: '프레스티지 명인 (명인 P)', rate: 0.95 };
    }
  }

  static calculateSeniorPerformanceBonus(monthlyTP, clubTierKey = 'club_350') {
    let achBonus = monthlyTP >= 300000 ? monthlyTP * 2.0 : monthlyTP * 0.7;
    const clubParams = this.getClubBonusParams(clubTierKey);
    let clubBonus = Math.min(5000000, monthlyTP * clubParams.rate);
    let myungInBonus = 0;
    if (monthlyTP > 5000000) {
      const excess = monthlyTP - 5000000;
      const rate = clubTierKey === 'club_350' ? 1.0 : (clubTierKey === 'club_230' ? 0.95 : 0);
      myungInBonus = Math.min(5000000, excess * rate);
    }
    return Math.round(achBonus + clubBonus + myungInBonus);
  }

  static getNewPlannerSupport(tenureMonth, monthlyTP) {
    if (tenureMonth > 24) return 0;
    let baseSettlement = monthlyTP >= 700000 ? 2300000 : (monthlyTP >= 500000 ? 2100000 : (monthlyTP >= 300000 ? 1500000 : 500000));
    let perfBonus = 0;
    if (tenureMonth <= 11) {
      if (monthlyTP >= 1000000) perfBonus = 1900000 + (monthlyTP - 1000000) * 1.5;
      else if (monthlyTP >= 700000) perfBonus = 1400000;
      else if (monthlyTP >= 500000) perfBonus = 1000000;
      else if (monthlyTP >= 400000) perfBonus = 500000;
      else if (monthlyTP >= 300000) perfBonus = 400000;
    } else {
      if (monthlyTP >= 1000000) perfBonus = 2100000 + (monthlyTP - 1000000) * 1.5;
      else if (monthlyTP >= 700000) perfBonus = 1600000;
      else if (monthlyTP >= 500000) perfBonus = 1350000;
      else if (monthlyTP >= 400000) perfBonus = 1000000;
      else if (monthlyTP >= 300000) perfBonus = 900000;
    }
    return Math.round(baseSettlement + perfBonus);
  }

  static getFeeSchedule(productGroup, isSenior = false) {
    if (!isSenior) {
      if (productGroup === '종신/GI 보험') return [112, 8,8,8,8,8,8,8,8,8,8,8, 20,20, 12];
      if (productGroup === '건강/상해보험') return [200, 0,0,0,0,0,0,0,0,0,0,0, 20,20, 12];
      return [102, 8,8,8,8,8,8,8,8,8,8,8, 20,20, 12];
    } else {
      if (productGroup === '연금/저축성보험') return [110, 10,10,10,10,10,10,10,10,10,10,10, 10,10, 2];
      return [230, 0,0,0,0,0,0,0,0,0,0,0, 10,10, 2];
    }
  }

  static calculateMonthlySchedule(contract, horizonMonths = 24, joinDateStr = '2025-01') {
    const schedule = [];
    const startDate = new Date(contract.startDate);
    const today = new Date();
    const premium = Number(contract.premium) || 0;
    const isSenior = this.calculateTenureMonth(joinDateStr, today) > 24;
    const feeRates = this.getFeeSchedule(contract.productGroup, isSenior);
    const promotions = contract.promotions || [];
    const status = contract.status || '정상유지';
    const terminationMonth = Number(contract.terminationMonth) || 6;

    for (let m = 0; m < horizonMonths; m++) {
      const monthDate = new Date(today.getFullYear(), today.getMonth() + m, 1);
      const elapsedMonths = (monthDate.getFullYear() - startDate.getFullYear()) * 12 + (monthDate.getMonth() - startDate.getMonth());
      
      let commissionIncome = 0, promoIncome = 0, premiumExpense = 0, clawbackAmount = 0;
      const isTerminatedBeforeThisMonth = (status === '해지' || status === '실효') && (elapsedMonths >= terminationMonth);
      const isTerminatedThisMonth = (status === '해지' || status === '실효') && (elapsedMonths === terminationMonth);

      if (elapsedMonths >= 0 && elapsedMonths < 15 && !isTerminatedBeforeThisMonth) {
        commissionIncome = premium * ((feeRates[elapsedMonths] || 0) / 100);
        promotions.forEach(promo => {
          if (elapsedMonths === Number(promo.afterPaymentMonth)) {
            let pVal = Number(promo.value) || 0;
            promoIncome += (promo.type === 'percent' ? premium * (pVal / 100) : pVal);
          }
        });
      }

      if (isTerminatedThisMonth && terminationMonth < 25) {
        let totalPromoReceived = 0;
        promotions.forEach(promo => {
          if (Number(promo.afterPaymentMonth) <= terminationMonth) {
            let pVal = Number(promo.value) || 0;
            totalPromoReceived += (promo.type === 'percent' ? premium * (pVal / 100) : pVal);
          }
        });
        clawbackAmount = Math.round(totalPromoReceived * 0.70);
      }

      if (contract.contractType === '자기계약' && !isTerminatedBeforeThisMonth) {
        if (elapsedMonths >= 0 && elapsedMonths < (Number(contract.paymentYears) || 20) * 12) {
          premiumExpense = premium;
        }
      }

      const totalGrossIncome = commissionIncome + promoIncome - clawbackAmount;
      const netIncome = totalGrossIncome - Math.round(Math.max(0, totalGrossIncome) * 0.008);
      schedule.push({
        monthLabel: `${monthDate.getFullYear()}.${String(monthDate.getMonth() + 1).padStart(2, '0')}`,
        netIncome: Math.round(netIncome),
        premiumExpense: Math.round(premiumExpense),
        netProfit: Math.round(netIncome - premiumExpense),
        contractType: contract.contractType
      });
    }
    return schedule;
  }

  static calculateAggregatedCashflow(contracts, horizonMonths = 24, joinDateStr = '2025-01', clubKey = 'club_350', onlySelf = false) {
    const result = Array.from({ length: horizonMonths }, (_, m) => {
      const targetDate = new Date(new Date().getFullYear(), new Date().getMonth() + m, 1);
      const tenureMonth = this.calculateTenureMonth(joinDateStr, targetDate);
      let monthlyTP = 0;
      contracts.forEach(c => {
        if (c.status === '정상유지') {
          const s = new Date(c.startDate);
          if (s.getFullYear() === targetDate.getFullYear() && s.getMonth() === targetDate.getMonth()) monthlyTP += (Number(c.tp) || 0);
        }
      });
      let plannerBonus = onlySelf ? 0 : (tenureMonth <= 24 ? this.getNewPlannerSupport(tenureMonth, monthlyTP) : this.calculateSeniorPerformanceBonus(monthlyTP, clubKey));
      return { monthLabel: `${targetDate.getFullYear()}.${String(targetDate.getMonth() + 1).padStart(2, '0')}`, realIncome: plannerBonus, selfIncome: 0, totalIncome: plannerBonus, selfExpense: 0, netProfit: plannerBonus };
    });

    contracts.forEach(contract => {
      if (onlySelf && contract.contractType !== '자기계약') return;
      this.calculateMonthlySchedule(contract, horizonMonths, joinDateStr).forEach((item, idx) => {
        if (item.contractType === '진성계약') result[idx].realIncome += item.netIncome;
        else { result[idx].selfIncome += item.netIncome; result[idx].selfExpense += item.premiumExpense; }
        result[idx].totalIncome += item.netIncome;
        result[idx].netProfit += item.netProfit;
      });
    });
    return result;
  }
}

// --- UI Controller ---
class AppUI {
  constructor() {
    this.contracts = [];
    this.settings = LocalStorageStore.getSettings();
    this.initElements();
    this.bindEvents();
    this.loadDataAndRender();
  }

  initElements() {
    const joinDateInput = document.getElementById('planner-join-date');
    if (joinDateInput) joinDateInput.value = this.settings.joinDate;
    
    const clubTierSelect = document.getElementById('select-club-tier');
    if (clubTierSelect) clubTierSelect.value = this.settings.clubTier;
  }

  bindEvents() {
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
      loginBtn.addEventListener('click', async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        try {
          await AuthService.login(email, password);
          this.loadDataAndRender();
        } catch (e) {
          alert('로그인 실패: ' + e.message);
        }
      });
    }

    const joinDateInput = document.getElementById('planner-join-date');
    if (joinDateInput) {
      joinDateInput.addEventListener('change', (e) => {
        this.settings.joinDate = e.target.value;
        LocalStorageStore.saveSettings(this.settings);
        this.renderAll();
      });
    }

    const clubTierSelect = document.getElementById('select-club-tier');
    if (clubTierSelect) {
      clubTierSelect.addEventListener('change', (e) => {
        this.settings.clubTier = e.target.value;
        LocalStorageStore.saveSettings(this.settings);
        this.renderAll();
      });
    }

    const btnOpenModal = document.getElementById('btn-open-modal');
    if (btnOpenModal) {
      btnOpenModal.addEventListener('click', () => {
        document.getElementById('contract-modal').classList.remove('hidden');
      });
    }

    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnCancelModal = document.getElementById('btn-cancel-modal');
    const contractModal = document.getElementById('contract-modal');
    
    const closeContractModal = () => contractModal.classList.add('hidden');
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeContractModal);
    if (btnCancelModal) btnCancelModal.addEventListener('click', closeContractModal);

    const btnCloseDetailModal = document.getElementById('btn-close-detail-modal');
    if (btnCloseDetailModal) {
      btnCloseDetailModal.addEventListener('click', () => {
        document.getElementById('detail-modal').classList.add('hidden');
      });
    }

    const btnCloseRulesModal = document.getElementById('btn-close-rules-modal');
    if (btnCloseRulesModal) {
      btnCloseRulesModal.addEventListener('click', () => {
        document.getElementById('rules-modal').classList.add('hidden');
      });
    }
  }

  async loadDataAndRender() {
    const user = await AuthService.checkAuth();
    if (user) {
      this.contracts = await ContractService.getContracts();
      const userEmailEl = document.getElementById('user-email');
      if (userEmailEl) userEmailEl.textContent = user.email;
    } else {
      this.contracts = [];
    }
    this.renderAll();
  }

  // ... (나머지 메서드들)
}

document.addEventListener('DOMContentLoaded', () => { new AppUI(); });