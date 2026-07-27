/**
 * GFC Premium Manager - Samsung Life GFC Planner System
 * Features: Manual Club Tier Selection (9 tiers including 30 만 Club),
 * Senior Performance Bonuses (Club & Achievement), New Planner Support,
 * Multi-promotions, 16th month surrender values, and Employment Insurance deductions.
 * Updated with Independent Monthly TP Calculation, Detailed Multi-month Cashflow & Self Analysis.
 */

// --- Data Model & Storage ---
class ContractStore {
  static STORAGE_KEY = 'gfc_premium_manager_v5';

  static getContracts() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load contracts:', e);
      return [];
    }
  }

  static saveContracts(contracts) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(contracts));
    } catch (e) {
      console.error('Failed to save contracts:', e);
    }
  }

  static async getSettings() {
    const user = await this.checkAuth();
    if (user) {
      const { data, error } = await window.supabase
        .from('profiles')
        .select('settings')
        .eq('id', user.id)
        .single();
      if (data && data.settings) return data.settings;
    }
    try {
      const data = localStorage.getItem(this.STORAGE_KEY + '_settings');
      return data ? JSON.parse(data) : { joinDate: '2025-01', clubTier: 'club_350' };
    } catch (e) {
      return { joinDate: '2025-01', clubTier: 'club_350' };
    }
  }

  static async saveSettings(settings) {
    const user = await this.checkAuth();
    if (user) {
      await window.supabase
        .from('profiles')
        .upsert({ id: user.id, settings: settings });
    }
    localStorage.setItem(this.STORAGE_KEY + '_settings', JSON.stringify(settings));
  }

  // 인증 상태 관리
  static async checkAuth() {
    const { data: { user } } = await window.supabase.auth.getUser();
    return user;
  }

  static async login(email, password) {
    if (!window.supabase) {
      console.error('Supabase 객체 없음:', window.supabase);
      throw new Error('Supabase가 초기화되지 않았습니다.');
    }
    const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  static async logout() {
    if (window.supabase) {
      await window.supabase.auth.signOut();
    }
  }

  // Supabase 연동 메서드 (사용자별 데이터 필터링)
  static async getContractsFromSupabase() {
    const { data, error } = await window.supabase
      .from('contracts')
      .select('*');
    
    if (error) {
      console.error('Supabase 데이터 로드 에러:', error);
      return [];
    }
    return data || [];
  }

  static async syncToSupabase(contract) {
    const user = await this.checkAuth();
    if (!user) return;
    
    const { data, error } = await window.supabase
      .from('contracts')
      .insert([{ ...contract, user_id: user.id }]);
    if (error) throw error;
    return data;
  }

  // 로컬 데이터를 Supabase 로 마이그레이션
  static async migrateLocalDataToSupabase() {
    const user = await this.checkAuth();
    if (!user) return { success: false, message: '로그인이 필요합니다.' };

    const localContracts = this.getContracts();
    if (localContracts.length === 0) {
      return { success: true, message: '마이그레이션할 로컬 데이터가 없습니다.' };
    }

    try {
      const { data: existingData } = await window.supabase
        .from('contracts')
        .select('id')
        .eq('user_id', user.id);

      const existingIds = new Set((existingData || []).map(d => d.id));

      const contractsToInsert = localContracts.filter(c => !existingIds.has(c.id));

      if (contractsToInsert.length === 0) {
        return { success: true, message: '모든 데이터가 이미 Supabase 에 있습니다.' };
      }

      const { error: insertError } = await window.supabase
        .from('contracts')
        .insert(contractsToInsert.map(c => ({ ...c, user_id: user.id })));

      if (insertError) {
        console.error('Supabase insert error:', insertError);
        return { success: false, message: 'Supabase 저장 실패: ' + insertError.message };
      }

      this.saveContracts([]);

      return { success: true, message: `${contractsToInsert.length}개의 데이터를 Supabase 로 마이그레이션했습니다.` };
    } catch (e) {
      console.error('Migration error:', e);
      return { success: false, message: '마이그레이션 중 오류 발생: ' + e.message };
    }
  }

  static addContract(contract) {
    const contracts = this.getContracts();
    contract.id = 'GFC*' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    contract.createdAt = new Date().toISOString();
    contracts.unshift(contract);
    this.saveContracts(contracts);
    return contract;
  }

  static updateContract(updatedContract) {
    let contracts = this.getContracts();
    contracts = contracts.map(c => c.id === updatedContract.id ? { ...c, ...updatedContract } : c);
    this.saveContracts(contracts);
  }

  static deleteContract(id) {
    let contracts = this.getContracts();
    contracts = contracts.filter(c => c.id !== id);
    this.saveContracts(contracts);
  }

  // Supabase 연동 메서드들
  static async addContractToSupabase(contract) {
    const user = await this.checkAuth();
    if (!user) throw new Error('로그인이 필요합니다.');
    
    const contractToSave = {
      ...contract,
      user_id: user.id,
      id: 'GFC*' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      createdAt: new Date().toISOString()
    };
    
    console.log('Supabase insert payload:', contractToSave);
    
    const { data, error } = await window.supabase
      .from('contracts')
      .insert([contractToSave])
      .select();
    
    if (error) {
      console.error('Supabase insert error details:', error);
      throw error;
    }
    return data[0];
  }

  static async updateContractToSupabase(contract) {
    const user = await this.checkAuth();
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

  static async deleteContractFromSupabase(id) {
    const user = await this.checkAuth();
    if (!user) throw new Error('로그인이 필요합니다.');
    
    const { error } = await window.supabase
      .from('contracts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    
    if (error) throw error;
  }

  static generateSampleData() {
    const today = new Date();
    const formatDate = (monthsAgo) => {
      const d = new Date(today);
      d.setMonth(d.getMonth() - monthsAgo);
      return d.toISOString().split('T')[0];
    };

    const samples = [
      {
        id: 'SMP-1',
        contractType: '진성계약',
        status: '정상유지',
        terminationMonth: 6,
        productGroup: '건강/상해보험',
        client: '김철수',
        company: '삼성생명',
        title: '무배당 통합건강보험',
        startDate: formatDate(1),
        premium: 200000,
        paymentYears: 20,
        tp: 240000,
        surrenderValue16: 1200000,
        promotions: [
          { type: 'percent', value: 300, afterPaymentMonth: 1 }
        ],
        memo: '건강보험 300% 시책 (1 회차 납입 후 익월 지급)',
        createdAt: new Date().toISOString()
      },
      {
        id: 'SMP-2',
        contractType: '자기계약',
        status: '정상유지',
        terminationMonth: 6,
        productGroup: '종신/GI 보험',
        client: '본인 (GFC)',
        company: '삼성생명',
        title: '무배당 경영인 종신보험 (자기)',
        startDate: formatDate(2),
        premium: 300000,
        paymentYears: 10,
        tp: 360000,
        surrenderValue16: 2500000,
        promotions: [
          { type: 'amount', value: 200000, afterPaymentMonth: 1 },
          { type: 'percent', value: 100, afterPaymentMonth: 13 }
        ],
        memo: '종신 자기계약 및 16 회차 해지 환급금 수지분석',
        createdAt: new Date().toISOString()
      }
    ];

    this.saveContracts(samples);
    return samples;
  }
}

// --- GFC Advanced Financial Engine (Manual Club Tier Integration with 30 만 Club) ---
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
    let clubBonus = monthlyTP * clubParams.rate;
    if (clubBonus > 5000000) clubBonus = 5000000;

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

    let baseSettlement = 0;
    if (monthlyTP >= 700000) baseSettlement = 2300000;
    else if (monthlyTP >= 500000) baseSettlement = 2100000;
    else if (monthlyTP >= 300000) baseSettlement = 1500000;
    else baseSettlement = 500000;

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
      
      let commissionIncome = 0;
      let promoIncome = 0;
      let premiumExpense = 0;
      let clawbackAmount = 0;

      const isTerminatedBeforeThisMonth = (status === '해지' || status === '실효') && (elapsedMonths >= terminationMonth);
      const isTerminatedThisMonth = (status === '해지' || status === '실효') && (elapsedMonths === terminationMonth);

      if (elapsedMonths >= 0 && elapsedMonths < 15 && !isTerminatedBeforeThisMonth) {
        const rate = feeRates[elapsedMonths] || 0;
        commissionIncome = premium * (rate / 100);

        promotions.forEach(promo => {
          const targetDepositMonth = Number(promo.afterPaymentMonth) || 1;
          const payoutElapsedMonth = targetDepositMonth;
          
          if (elapsedMonths === payoutElapsedMonth) {
            let pVal = Number(promo.value) || 0;
            let earnedPromo = promo.type === 'percent' ? premium * (pVal / 100) : pVal;
            promoIncome += earnedPromo;
          }
        });
      }

      if (isTerminatedThisMonth && terminationMonth < 25) {
        let totalPromoReceived = 0;
        promotions.forEach(promo => {
          const targetDepositMonth = Number(promo.afterPaymentMonth) || 1;
          if (targetDepositMonth <= terminationMonth) {
            let pVal = Number(promo.value) || 0;
            totalPromoReceived += (promo.type === 'percent' ? premium * (pVal / 100) : pVal);
          }
        });
        clawbackAmount = Math.round(totalPromoReceived * 0.70);
      }

      if (contract.contractType === '자기계약' && !isTerminatedBeforeThisMonth) {
        const paymentYears = Number(contract.paymentYears) || 20;
        const paymentMonths = paymentYears * 12;
        if (elapsedMonths >= 0 && elapsedMonths < paymentMonths) {
          premiumExpense = premium;
        }
      }

      const totalGrossIncome = commissionIncome + promoIncome - clawbackAmount;
      const employmentInsDeduction = Math.round(Math.max(0, totalGrossIncome) * 0.008);
      const netIncome = totalGrossIncome - employmentInsDeduction;

      schedule.push({
        monthIndex: m,
        monthLabel: `${monthDate.getFullYear()}.${String(monthDate.getMonth() + 1).padStart(2, '0')}`,
        commissionIncome: Math.round(commissionIncome),
        promoIncome: Math.round(promoIncome),
        clawbackAmount: Math.round(clawbackAmount),
        totalGrossIncome: Math.round(totalGrossIncome),
        employmentInsDeduction,
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
      const today = new Date();
      const targetDate = new Date(today.getFullYear(), today.getMonth() + m, 1);
      const tenureMonth = this.calculateTenureMonth(joinDateStr, targetDate);

      let monthlyTP = 0;
      contracts.forEach(c => {
        if (c.status === '정상유지') {
          const startDate = new Date(c.startDate);
          const contractYear = startDate.getFullYear();
          const contractMonth = startDate.getMonth();
          const targetYear = targetDate.getFullYear();
          const targetMonth = targetDate.getMonth();

          if (contractYear === targetYear && contractMonth === targetMonth) {
            monthlyTP += (Number(c.tp) || 0);
          }
        }
      });

      let plannerBonus = 0;
      if (!onlySelf) {
        if (tenureMonth <= 24) {
          plannerBonus = this.getNewPlannerSupport(tenureMonth, monthlyTP);
        } else {
          plannerBonus = this.calculateSeniorPerformanceBonus(monthlyTP, clubKey);
        }
      }

      return {
        monthIndex: m,
        monthLabel: `${targetDate.getFullYear()}.${String(targetDate.getMonth() + 1).padStart(2, '0')}`,
        realIncome: plannerBonus,
        selfIncome: 0,
        totalIncome: plannerBonus,
        selfExpense: 0,
        netProfit: plannerBonus
      };
    });

    contracts.forEach(contract => {
      if (onlySelf && contract.contractType !== '자기계약') return;

      const schedule = this.calculateMonthlySchedule(contract, horizonMonths, joinDateStr);
      schedule.forEach((item, idx) => {
        if (item.contractType === '진성계약') {
          result[idx].realIncome += item.netIncome;
        } else {
          result[idx].selfIncome += item.netIncome;
          result[idx].selfExpense += item.premiumExpense;
        }
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
    this.chart = null;
    this.currentFilter = 'all';
    this.searchTerm = '';
    this.currentChartTab = 'all';
    this.settings = ContractStore.getSettings();

    this.initElements();
    this.bindEvents();
    this.loadDataAndRender();
  }

  initElements() {
    this.kpiTotalCount = document.getElementById('kpi-total-count');
    this.kpiContractBreakdown = document.getElementById('kpi-contract-breakdown');
    this.kpiRealIncome = document.getElementById('kpi-real-income');
    this.kpiSelfExpense = document.getElementById('kpi-self-expense');
    this.kpiNetProfit = document.getElementById('kpi-net-profit');

    this.tbody = document.getElementById('contract-list-tbody');
    this.emptyState = document.getElementById('empty-state');
    this.searchInput = document.getElementById('search-input');
    this.chartRangeSelect = document.getElementById('chart-range');
    this.selfAnalysisContainer = document.getElementById('self-contract-analysis');
    this.plannerJoinInput = document.getElementById('planner-join-date');
    this.plannerTenureBadge = document.getElementById('planner-tenure-badge');
    this.selectClubTier = document.getElementById('select-club-tier');

    this.tabAllFlow = document.getElementById('tab-all-flow');
    this.tabSelfFlow = document.getElementById('tab-self-flow');

    this.modal = document.getElementById('contract-modal');
    this.modalTitle = document.getElementById('modal-title');
    this.contractForm = document.getElementById('contract-form');
    this.btnOpenModal = document.getElementById('btn-open-modal');
    this.btnCloseModal = document.getElementById('btn-close-modal');
    this.btnCancelModal = document.getElementById('btn-cancel-modal');
    this.btnAddPromo = document.getElementById('btn-add-promo');
    this.promotionsContainer = document.getElementById('promotions-container');
    this.formStatus = document.getElementById('form-status');
    this.terminationWrapper = document.getElementById('termination-month-wrapper');

    this.rulesModal = document.getElementById('rules-modal');
    this.btnOpenRulesModal = document.getElementById('btn-open-rules-modal');
    this.btnCloseRulesModal = document.getElementById('btn-close-rules-modal');

    this.detailModal = document.getElementById('detail-modal');
    this.btnCloseDetailModal = document.getElementById('btn-close-detail-modal');
    this.detailModalTitle = document.getElementById('detail-modal-title');
    this.detailModalBody = document.getElementById('detail-modal-body');

    this.btnSampleData = document.getElementById('btn-sample-data');
    this.btnExport = document.getElementById('btn-export');
    this.btnMigrate = document.getElementById('btn-migrate');
    this.importFileInput = document.getElementById('import-file');
  }

  bindEvents() {
    document.getElementById('btn-logout').addEventListener('click', async () => {
      await ContractStore.logout();
      location.reload();
    });

    this.btnOpenModal.addEventListener('click', () => this.openModal());
    this.btnCloseModal.addEventListener('click', () => this.closeModal());
    this.btnCancelModal.addEventListener('click', () => this.closeModal());
    this.btnAddPromo.addEventListener('click', () => this.addPromoRow());

    this.btnOpenRulesModal.addEventListener('click', () => this.rulesModal.classList.remove('hidden'));
    this.btnCloseRulesModal.addEventListener('click', () => this.rulesModal.classList.add('hidden'));

    this.btnCloseDetailModal.addEventListener('click', () => this.detailModal.classList.add('hidden'));

    document.querySelectorAll('.rule-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.rule-tab').forEach(t => {
          t.classList.remove('bg-emerald-600', 'text-white', 'font-bold');
          t.classList.add('bg-slate-100', 'text-slate-700', 'font-medium');
        });
        e.target.classList.remove('bg-slate-100', 'text-slate-700', 'font-medium');
        e.target.classList.add('bg-emerald-600', 'text-white', 'font-bold');

        const targetTab = e.target.dataset.ruleTab;
        document.querySelectorAll('.rule-panel').forEach(p => p.classList.add('hidden'));
        document.getElementById(`rule-content-${targetTab}`).classList.remove('hidden');
      });
    });

    this.contractForm.addEventListener('submit', (e) => this.handleFormSubmit(e));

    this.formStatus.addEventListener('change', (e) => {
      if (e.target.value === '해지' || e.target.value === '실효') {
        this.terminationWrapper.classList.remove('hidden');
      } else {
        this.terminationWrapper.classList.add('hidden');
      }
    });

    this.plannerJoinInput.addEventListener('change', (e) => {
      this.settings.joinDate = e.target.value;
      ContractStore.saveSettings(this.settings);
      this.renderAll();
    });

    this.selectClubTier.addEventListener('change', (e) => {
      this.settings.clubTier = e.target.value;
      ContractStore.saveSettings(this.settings);
      this.renderKPIs();
      this.renderChart();
    });

    this.tabAllFlow.addEventListener('click', () => {
      this.currentChartTab = 'all';
      this.tabAllFlow.className = 'chart-tab active px-3 py-1.5 rounded-md transition text-emerald-700 bg-white shadow-sm font-bold';
      this.tabSelfFlow.className = 'chart-tab px-3 py-1.5 rounded-md transition text-slate-600 hover:text-slate-900 font-bold';
      this.renderChart();
    });

    this.tabSelfFlow.addEventListener('click', () => {
      this.currentChartTab = 'self';
      this.tabSelfFlow.className = 'chart-tab active px-3 py-1.5 rounded-md transition text-emerald-700 bg-white shadow-sm font-bold';
      this.tabAllFlow.className = 'chart-tab px-3 py-1.5 rounded-md transition text-slate-600 hover:text-slate-900 font-bold';
      this.renderChart();
    });

    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-tab').forEach(t => {
          t.classList.remove('active', 'text-emerald-700', 'bg-white', 'shadow-sm');
          t.classList.add('text-slate-600');
        });
        e.target.classList.add('active', 'text-emerald-700', 'bg-white', 'shadow-sm');
        e.target.classList.remove('text-slate-600');

        this.currentFilter = e.target.dataset.filter;
        this.renderContractTable();
      });
    });

    this.searchInput.addEventListener('input', (e) => {
      this.searchTerm = e.target.value.toLowerCase();
      this.renderContractTable();
    });

    this.chartRangeSelect.addEventListener('change', () => this.renderChart());

    this.btnSampleData.addEventListener('click', () => {
      if (confirm('클럽 등급 직접선택 샘플 데이터로 로드하시겠습니까?')) {
        this.contracts = ContractStore.generateSampleData();
        this.renderAll();
      }
    });

    this.btnMigrate.addEventListener('click', async () => {
      const localContracts = ContractStore.getContracts();
      if (localContracts.length === 0) {
        alert('마이그레이션할 로컬 데이터가 없습니다.');
        return;
      }

      try {
        const user = await ContractStore.checkAuth();
        if (!user) {
          alert('로그인이 필요합니다. 먼저 로그인해주세요.');
          return;
        }

        if (confirm(`${localContracts.length}개의 로컬 데이터를 Supabase 로 마이그레이션하시겠습니까?\n\n마이그레이션 후 로컬 데이터는 삭제됩니다.`)) {
          const result = await ContractStore.migrateLocalDataToSupabase();
          alert(result.message);
          if (result.success) {
            this.contracts = await ContractStore.getContractsFromSupabase();
            this.renderAll();
          }
        }
      } catch (e) {
        alert('마이그레이션 중 오류 발생: ' + e.message);
      }
    });

    this.btnExport.addEventListener('click', () => this.exportData());
    this.importFileInput.addEventListener('change', (e) => this.importData(e));
  }

  async loadDataAndRender() {
    try {
      const user = await ContractStore.checkAuth();
      if (user) {
        document.getElementById('login-container').classList.add('hidden');
        document.getElementById('auth-container').classList.remove('hidden');
        document.getElementById('user-email').textContent = user.email;
        
        this.contracts = await ContractStore.getContractsFromSupabase();
        
        if (this.settings.joinDate) this.plannerJoinInput.value = this.settings.joinDate;
        if (this.settings.clubTier) this.selectClubTier.value = this.settings.clubTier;
      } else {
        document.getElementById('login-container').classList.remove('hidden');
        document.getElementById('auth-container').classList.add('hidden');
        this.contracts = [];
      }
    } catch (e) {
      console.error('Auth check failed:', e);
    }

    this.renderAll();
  }

  renderAll() {
    const tenure = GfcAdvancedEngine.calculateTenureMonth(this.settings.joinDate);
    this.plannerTenureBadge.textContent = `${tenure}차월`;

    this.renderKPIs();
    this.renderContractTable();
    this.renderSelfAnalysis();
    this.renderChart();
    lucide.createIcons();
  }

  renderKPIs() {
    const totalCount = this.contracts.length;
    const realCount = this.contracts.filter(c => c.contractType === '진성계약').length;
    const selfCount = this.contracts.filter(c => c.contractType === '자기계약').length;

    if (!this.settings.joinDate) {
      this.kpiTotalCount.textContent = '0 건';
      this.kpiContractBreakdown.textContent = '진성계약 0 건 · 자기계약 0 건';
      this.kpiRealIncome.textContent = '0 원';
      this.kpiSelfExpense.textContent = '0 원';
      this.kpiNetProfit.textContent = '0 원';
      this.kpiNetProfit.className = 'text-2xl font-extrabold mt-1 text-slate-900';
      return;
    }

    const clubKey = this.selectClubTier.value || 'club_350';
    const aggregated = GfcAdvancedEngine.calculateAggregatedCashflow(this.contracts, 1, this.settings.joinDate, clubKey, false);
    const currentMonth = aggregated[0] || { totalIncome: 0, selfExpense: 0, netProfit: 0 };

    this.kpiTotalCount.textContent = `${totalCount} 건`;
    this.kpiContractBreakdown.textContent = `진성계약 ${realCount}건 · 자기계약 ${selfCount}건`;

    this.kpiRealIncome.textContent = `${currentMonth.totalIncome.toLocaleString()} 원`;
    this.kpiSelfExpense.textContent = `${currentMonth.selfExpense.toLocaleString()} 원`;
    
    const netFormatted = `${currentMonth.netProfit >= 0 ? '+' : ''}${currentMonth.netProfit.toLocaleString()} 원`;
    this.kpiNetProfit.textContent = netFormatted;
    this.kpiNetProfit.className = `text-2xl font-extrabold mt-1 ${currentMonth.netProfit >= 0 ? 'text-slate-900' : 'text-rose-600'}`;
  }

  renderContractTable() {
    let filtered = this.contracts.filter(c => {
      const matchFilter = this.currentFilter === 'all' || c.contractType === this.currentFilter;
      const matchSearch = !this.searchTerm || 
        c.client.toLowerCase().includes(this.searchTerm) || 
        c.company.toLowerCase().includes(this.searchTerm) ||
        c.title.toLowerCase().includes(this.searchTerm) ||
        c.productGroup.toLowerCase().includes(this.searchTerm);
      return matchFilter && matchSearch;
    });

    if (filtered.length === 0) {
      this.tbody.innerHTML = '';
      this.emptyState.classList.remove('hidden');
      return;
    }

    this.emptyState.classList.add('hidden');
    this.tbody.innerHTML = filtered.map(c => {
      const isSelf = c.contractType === '자기계약';
      const badgeClass = isSelf ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200';
      const status = c.status || '정상유지';
      const statusBadge = status === '정상유지' 
        ? '<span class="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[10px]">정상</span>'
        : `<span class="px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded text-[10px]">${status}(${c.terminationMonth}m)</span>`;

      const premium = Number(c.premium) || 0;
      const paymentYears = Number(c.paymentYears) || 20;
      const tp = Number(c.tp) || 0;
      const surrender16 = Number(c.surrenderValue16) || 0;

      const promotions = c.promotions || [];
      const totalPromoCalc = promotions.reduce((sum, p) => {
        const val = Number(p.value) || 0;
        return sum + (p.type === 'percent' ? premium * (val / 100) : val);
      }, 0);

      return `
        <tr class="hover:bg-slate-50/80 transition">
          <td class="py-3 px-4">
            <div class="flex items-center space-x-1.5">
              <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${badgeClass}">
                ${c.contractType}
              </span>
              ${statusBadge}
            </div>
          </td>
          <td class="py-3 px-4 font-semibold text-slate-800">
            <div>${c.title}</div>
            <div class="text-[11px] font-normal text-emerald-600">${c.productGroup}</div>
          </td>
          <td class="py-3 px-4 text-slate-700">
            <div class="font-medium">${c.client}</div>
            <div class="text-[11px] text-slate-400">${c.company}</div>
          </td>
          <td class="py-3 px-4 text-slate-500 whitespace-nowrap">${c.startDate}</td>
          <td class="py-3 px-4 text-right font-bold ${isSelf ? 'text-rose-600' : 'text-slate-800'}">
            ${premium.toLocaleString()}원
            <div class="text-[10px] font-normal text-slate-400">${paymentYears}년납</div>
          </td>
          <td class="py-3 px-4 text-right font-bold text-slate-700">
            ${tp.toLocaleString()}원
          </td>
          <td class="py-3 px-4 text-right font-bold text-emerald-600">
            +${Math.round(totalPromoCalc).toLocaleString()}원
            <div class="text-[10px] font-normal text-slate-400">${promotions.length}개 시책</div>
          </td>
          <td class="py-3 px-4 text-slate-600 whitespace-nowrap">
            <div class="font-medium text-amber-700">${surrender16 > 0 ? surrender16.toLocaleString() + '원' : '미입력'}</div>
            <div class="text-[10px] text-slate-400">16 회 해지 환급금</div>
          </td>
          <td class="py-3 px-4 text-center whitespace-nowrap">
            <div class="flex items-center justify-center space-x-1">
              <button onclick="app.openModal('${c.id}')" class="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition" title="수정">
                <i data-lucide="edit-2" class="w-4 h-4"></i>
              </button>
              <button onclick="app.deleteContract('${c.id}')" class="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="삭제">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  }

  renderSelfAnalysis() {
    const selfContracts = this.contracts.filter(c => c.contractType === '자기계약');

    if (selfContracts.length === 0) {
      this.selfAnalysisContainer.innerHTML = `
        <div class="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500 text-center py-6">
          <i data-lucide="check-circle-2" class="w-8 h-8 text-emerald-500 mx-auto mb-2"></i>
          등록된 자기계약이 없습니다.
        </div>
      `;
      lucide.createIcons();
      return;
    }

    this.selfAnalysisContainer.innerHTML = selfContracts.map(c => {
      const isSenior = GfcAdvancedEngine.calculateTenureMonth(this.settings.joinDate) > 24;
      const premium = Number(c.premium) || 0;
      const surrender16 = Number(c.surrenderValue16) || 0;

      const feeRates = GfcAdvancedEngine.getFeeSchedule(c.productGroup, isSenior);
      const totalComm = feeRates.reduce((a, b) => a + premium * (b / 100), 0);
      
      const promotions = c.promotions || [];
      const totalPromoCalc = promotions.reduce((sum, p) => {
        const val = Number(p.value) || 0;
        return sum + (p.type === 'percent' ? premium * (val / 100) : val);
      }, 0);

      const totalIncomeNet = (totalComm + totalPromoCalc) * (1 - 0.008);
      const totalExpense15 = premium * 15;
      const netProfitAt16 = totalIncomeNet + surrender16 - totalExpense15;

      return `
        <div onclick="app.openSelfContractDetail('${c.id}')" class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2 cursor-pointer hover:border-emerald-500 transition group" title="클릭하여 상세 수지분석 보기">
          <div class="flex justify-between items-start">
            <span class="font-bold text-slate-800 flex items-center gap-1">${c.title} <i data-lucide="external-link" class="w-3 h-3 text-emerald-600 group-hover:scale-110 transition"></i></span>
            <span class="px-2 py-0.5 bg-rose-100 text-rose-700 rounded text-[10px] font-bold">자기계약 수지분석</span>
          </div>
          
          <div class="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/60 text-slate-600">
            <div>
              <span class="text-slate-400 block text-[10px]">15 회 총 납입지출</span>
              <span class="font-bold text-slate-800">-${totalExpense15.toLocaleString()}원</span>
            </div>
            <div>
              <span class="text-slate-400 block text-[10px]">수수료 + 시책 (공제후)</span>
              <span class="font-bold text-emerald-600">+${Math.round(totalIncomeNet).toLocaleString()}원</span>
            </div>
            <div>
              <span class="text-slate-400 block text-[10px]">16 회 해약환급금</span>
              <span class="font-bold text-blue-600">+${surrender16.toLocaleString()}원</span>
            </div>
            <div>
              <span class="text-slate-400 block text-[10px]">16 회 해지 시 최종순손익</span>
              <span class="font-bold ${netProfitAt16 >= 0 ? 'text-emerald-600' : 'text-rose-600'}">
                ${netProfitAt16 >= 0 ? '+' : ''}${Math.round(netProfitAt16).toLocaleString()}원
              </span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    lucide.createIcons();
  }

  renderChart() {
    const horizon = Number(this.chartRangeSelect.value) || 24;
    const clubKey = this.selectClubTier.value || 'club_350';
    const onlySelf = (this.currentChartTab === 'self');
    const aggregated = GfcAdvancedEngine.calculateAggregatedCashflow(this.contracts, horizon, this.settings.joinDate, clubKey, onlySelf);

    const labels = aggregated.map(d => d.monthLabel);
    const realIncomes = aggregated.map(d => d.realIncome);
    const selfIncomes = aggregated.map(d => d.selfIncome);
    const selfExpenses = aggregated.map(d => d.selfExpense);
    const netProfits = aggregated.map(d => d.netProfit);

    const ctx = document.getElementById('cashflowChart').getContext('2d');

    if (this.chart) {
      this.chart.destroy();
    }

    const datasets = onlySelf ? [
      {
        label: '자기계약 수입 (공제후)',
        data: selfIncomes,
        backgroundColor: '#3b82f6',
        borderRadius: 4,
        stack: 'income'
      },
      {
        label: '자기계약 보험료 지출',
        data: selfExpenses,
        backgroundColor: '#f43f5e',
        borderRadius: 4,
        stack: 'expense'
      },
      {
        label: '자기계약 월 순손익',
        data: netProfits,
        type: 'line',
        borderColor: '#0f172a',
        borderWidth: 2,
        pointBackgroundColor: '#0f172a',
        fill: false,
        tension: 0.3
      }
    ] : [
      {
        label: '진성 + 성과보너스 + 시책 수입 (공제후)',
        data: realIncomes,
        backgroundColor: '#059669',
        borderRadius: 4,
        stack: 'income'
      },
      {
        label: '자기계약 수입 (공제후)',
        data: selfIncomes,
        backgroundColor: '#3b82f6',
        borderRadius: 4,
        stack: 'income'
      },
      {
        label: '자기계약 보험료 지출',
        data: selfExpenses,
        backgroundColor: '#f43f5e',
        borderRadius: 4,
        stack: 'expense'
      },
      {
        label: '월 최종 순손익',
        data: netProfits,
        type: 'line',
        borderColor: '#0f172a',
        borderWidth: 2,
        pointBackgroundColor: '#0f172a',
        fill: false,
        tension: 0.3
      }
    ];

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              boxWidth: 12,
              font: { size: 11, family: 'Noto Sans KR' }
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const val = context.raw || 0;
                return `${context.dataset.label}: ${val.toLocaleString()} 원`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 } }
          },
          y: {
            ticks: {
              font: { size: 10 },
              callback: (value) => (value / 10000).toLocaleString() + '만'
            }
          }
        }
      }
    });
  }

  openDetailModal(type) {
    const clubKey = this.selectClubTier.value || 'club_350';
    const horizon = Number(this.chartRangeSelect ? this.chartRangeSelect.value : 24) || 24;
    const aggregated = GfcAdvancedEngine.calculateAggregatedCashflow(this.contracts, horizon, this.settings.joinDate, clubKey, false);

    let title = '월별 상세 수입 및 지출 예측 내역';

    const renderMonthDetail = (mIdx) => {
      const item = aggregated[mIdx] || aggregated[0];
      const targetDate = new Date();
      targetDate.setMonth(targetDate.getMonth() + mIdx);
      const tMonth = GfcAdvancedEngine.calculateTenureMonth(this.settings.joinDate, targetDate);
      const isSen = tMonth > 24;

      let totalTP = 0;
      let contractRows = this.contracts.map(c => {
        if (c.status !== '정상유지') return '';
        const startDate = new Date(c.startDate);
        const elapsed = (targetDate.getFullYear() - startDate.getFullYear()) * 12 + (targetDate.getMonth() - startDate.getMonth());
        if (elapsed < 0 || elapsed >= 15) return '';

        const tp = Number(c.tp) || 0;
        totalTP += tp;

        const feeRates = GfcAdvancedEngine.getFeeSchedule(c.productGroup, isSen);
        const rate = feeRates[elapsed] || 0;
        const comm = (Number(c.premium) || 0) * (rate / 100);

        let promo = 0;
        (c.promotions || []).forEach(p => {
          if ((Number(p.afterPaymentMonth) || 1) === (elapsed + 1)) {
            let val = Number(p.value) || 0;
            promo += (p.type === 'percent' ? (Number(c.premium) || 0) * (val / 100) : val);
          }
        });

        return `
          <div class="p-3 bg-white rounded-xl border border-slate-200 text-xs space-y-1">
            <div class="flex justify-between font-bold text-slate-800">
              <span>${c.title} (${c.client}) - [${c.contractType}]</span>
              <span class="text-emerald-600">+${Math.round(comm + promo).toLocaleString()}원</span>
            </div>
            <div class="text-[11px] text-slate-500 flex justify-between">
              <span>납입 ${elapsed + 1}회차 (수수료율 ${rate}%) | TP: ${tp.toLocaleString()}원</span>
              <span>수수료: ${Math.round(comm).toLocaleString()}원 / 시책: ${Math.round(promo).toLocaleString()}원</span>
            </div>
          </div>
        `;
      }).filter(Boolean).join('');

      let bonusBreakdown = '';
      if (!isSen) {
        let baseSettlement = 0;
        if (totalTP >= 700000) baseSettlement = 2300000;
        else if (totalTP >= 500000) baseSettlement = 2100000;
        else if (totalTP >= 300000) baseSettlement = 1500000;
        else baseSettlement = 500000;

        let perfBonus = 0;
        if (tMonth <= 11) {
          if (totalTP >= 1000000) perfBonus = 1900000 + (totalTP - 1000000) * 1.5;
          else if (totalTP >= 700000) perfBonus = 1400000;
          else if (totalTP >= 500000) perfBonus = 1000000;
          else if (totalTP >= 400000) perfBonus = 500000;
          else if (totalTP >= 300000) perfBonus = 400000;
        } else {
          if (totalTP >= 1000000) perfBonus = 2100000 + (totalTP - 1000000) * 1.5;
          else if (totalTP >= 700000) perfBonus = 1600000;
          else if (totalTP >= 500000) perfBonus = 1350000;
          else if (totalTP >= 400000) perfBonus = 1000000;
          else if (totalTP >= 300000) perfBonus = 900000;
        }

        bonusBreakdown = `
          <div class="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 space-y-1.5">
            <p class="font-bold text-sm">✨ 신인 GFC 지원금 세부 구성 (${tMonth}차월)</p>
            <div class="flex justify-between"><span>기본 정착수수료:</span> <strong>+${baseSettlement.toLocaleString()}원</strong></div>
            <div class="flex justify-between"><span>성과보너스 (업적 연동):</span> <strong>+${Math.round(perfBonus).toLocaleString()}원</strong></div>
            <div class="border-t border-emerald-200 pt-1.5 flex justify-between font-bold text-emerald-800 text-sm"><span>지원금 합계:</span> <strong>+${item.realIncome.toLocaleString()}원</strong></div>
          </div>
        `;
      } else {
        let achBonus = totalTP >= 300000 ? totalTP * 2.0 : totalTP * 0.7;
        let clubParams = GfcAdvancedEngine.getClubBonusParams(clubKey);
        let clubBonus = Math.min(5000000, totalTP * clubParams.rate);
        let myungInBonus = 0;
        if (totalTP > 5000000) {
          let excess = totalTP - 5000000;
          let mRate = clubKey === 'club_350' ? 1.0 : (clubKey === 'club_230' ? 0.95 : 0);
          myungInBonus = Math.min(5000000, excess * mRate);
        }

        bonusBreakdown = `
          <div class="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 space-y-1.5">
            <p class="font-bold text-sm">✨ 시니어 성과보너스 세부 구성 (${clubParams.name})</p>
            <div class="flex justify-between"><span>업적분 (${totalTP >= 300000 ? '200%' : '70%'}):</span> <strong>+${Math.round(achBonus).toLocaleString()}원</strong></div>
            <div class="flex justify-between"><span>클럽분 (${clubParams.name} ${clubParams.rate * 100}%):</span> <strong>+${Math.round(clubBonus).toLocaleString()}원</strong></div>
            ${myungInBonus > 0 ? `<div class="flex justify-between"><span>초과 명인보너스:</span> <strong>+${Math.round(myungInBonus).toLocaleString()}원</strong></div>` : ''}
            <div class="border-t border-emerald-200 pt-1.5 flex justify-between font-bold text-emerald-800 text-sm"><span>보너스 합계:</span> <strong>+${item.realIncome.toLocaleString()}원</strong></div>
          </div>
        `;
      }

      let selfExpenseDetails = this.contracts.map(c => {
        if (c.contractType !== '자기계약' || c.status !== '정상유지') return '';
        const startDate = new Date(c.startDate);
        const elapsed = (targetDate.getFullYear() - startDate.getFullYear()) * 12 + (targetDate.getMonth() - startDate.getMonth());
        const paymentMonths = (Number(c.paymentYears) || 20) * 12;
        if (elapsed < 0 || elapsed >= paymentMonths) return '';
        const prem = Number(c.premium) || 0;

        return `
          <div class="p-3 bg-white rounded-xl border border-slate-200 text-xs flex justify-between items-center">
            <div>
              <strong>${c.title} (${c.client})</strong>
              <div class="text-[10px] text-slate-500">보험사: ${c.company} | 납입 ${elapsed + 1}회차 진행중</div>
            </div>
            <strong class="text-rose-600 text-sm">-${prem.toLocaleString()}원</strong>
          </div>
        `;
      }).filter(Boolean).join('');

      return `
        <div class="space-y-4">
          <div class="flex items-center justify-between bg-slate-100 p-3 rounded-xl">
            <label class="font-bold text-slate-700 text-xs">조회 월 선택 (향후 ${horizon}개월):</label>
            <select id="detail-month-selector" class="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500">
              ${aggregated.map((d, i) => `<option value="${i}" ${i === mIdx ? 'selected' : ''}>${d.monthLabel} (${i + 1}번째 달)</option>`).join('')}
            </select>
          </div>

          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
              <span class="text-[10px] text-slate-500 block">당월 총수입</span>
              <strong class="text-emerald-700 text-sm">+${item.totalIncome.toLocaleString()}원</strong>
            </div>
            <div class="p-3 bg-rose-50 rounded-xl border border-rose-200">
              <span class="text-[10px] text-slate-500 block">자기계약 보험료지출</span>
              <strong class="text-rose-600 text-sm">-${item.selfExpense.toLocaleString()}원</strong>
            </div>
            <div class="p-3 bg-blue-50 rounded-xl border border-blue-200">
              <span class="text-[10px] text-slate-500 block">최종 순손익</span>
              <strong class="text-blue-700 text-sm">${item.netProfit >= 0 ? '+' : ''}${item.netProfit.toLocaleString()}원</strong>
            </div>
          </div>

          ${bonusBreakdown}

          <div>
            <h4 class="font-bold text-slate-800 mb-2 text-xs">해당 월 계약별 수수료 및 시책 상세 (당월 TP 합계: ${totalTP.toLocaleString()}원)</h4>
            <div class="space-y-2 max-h-[180px] overflow-y-auto custom-scrollbar">
              ${contractRows || '<p class="text-slate-400 text-center py-4">해당 월에 실적이 발생하는 정상유지 계약이 없습니다.</p>'}
            </div>
          </div>

          <div>
            <h4 class="font-bold text-slate-800 mb-2 text-xs">해당 월 자기계약 보험료 지출 상세</h4>
            <div class="space-y-2 max-h-[140px] overflow-y-auto custom-scrollbar">
              ${selfExpenseDetails || '<p class="text-slate-400 text-center py-4">지출 중인 자기계약이 없습니다.</p>'}
            </div>
          </div>
        </div>
      `;
    };

    this.detailModalTitle.textContent = title;
    this.detailModalBody.innerHTML = renderMonthDetail(0);
    this.detailModal.classList.remove('hidden');

    const selector = document.getElementById('detail-month-selector');
    if (selector) {
      selector.addEventListener('change', (e) => {
        const idx = Number(e.target.value);
        this.detailModalBody.innerHTML = renderMonthDetail(idx);
        const newSelector = document.getElementById('detail-month-selector');
        if (newSelector) newSelector.value = idx;
        lucide.createIcons();
      });
    }

    lucide.createIcons();
  }

  openSelfContractDetail(contractId) {
    const c = this.contracts.find(item => item.id === contractId);
    if (!c) return;

    const isSenior = GfcAdvancedEngine.calculateTenureMonth(this.settings.joinDate) > 24;
    const premium = Number(c.premium) || 0;
    const surrender16 = Number(c.surrenderValue16) || 0;

    const feeRates = GfcAdvancedEngine.getFeeSchedule(c.productGroup, isSenior);
    const totalComm = feeRates.reduce((a, b) => a + premium * (b / 100), 0);
    
    const promotions = c.promotions || [];
    const totalPromoCalc = promotions.reduce((sum, p) => {
      const val = Number(p.value) || 0;
      return sum + (p.type === 'percent' ? premium * (val / 100) : val);
    }, 0);

    const totalGross = totalComm + totalPromoCalc;
    const deduction = Math.round(totalGross * 0.008);
    const totalIncomeNet = totalGross - deduction;
    const totalExpense15 = premium * 15;
    const netProfitAt16 = totalIncomeNet + surrender16 - totalExpense15;

    let monthlyCommRows = feeRates.map((rate, idx) => {
      let comm = premium * (rate / 100);
      return `<div class="flex justify-between py-1 border-b border-slate-100"><span>${idx + 1}회차 (환산율 ${rate}%):</span> <strong class="text-emerald-600">+${Math.round(comm).toLocaleString()}원</strong></div>`;
    }).join('');

    let promoRows = promotions.map((p, idx) => {
      let val = Number(p.value) || 0;
      let earned = p.type === 'percent' ? premium * (val / 100) : val;
      return `<div class="flex justify-between py-1 border-b border-slate-100"><span>시책 #${idx + 1} (${p.afterPaymentMonth}회차 납입 후 익월):</span> <strong class="text-emerald-600">+${Math.round(earned).toLocaleString()}원</strong></div>`;
    }).join('') || '<p class="text-slate-400">적용된 시책이 없습니다.</p>';

    let htmlContent = `
      <div class="space-y-4">
        <div class="p-4 bg-rose-50 rounded-xl border border-rose-200 text-rose-900 space-y-2">
          <p class="font-bold text-sm">🛡️ ${c.title} (${c.client}) 16 회차 해지 수지분석 상세</p>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div>15 회 총 납입지출: <strong class="text-rose-600">-${totalExpense15.toLocaleString()}원</strong></div>
            <div>해약환급금(16 회차): <strong class="text-blue-600">+${surrender16.toLocaleString()}원</strong></div>
            <div>수수료 + 시책 (공제전): <strong class="text-emerald-600">+${Math.round(totalGross).toLocaleString()}원</strong></div>
            <div>고용보험공제 (0.8%): <strong class="text-rose-600">-${deduction.toLocaleString()}원</strong></div>
          </div>
          <div class="border-t border-rose-200 pt-2 flex justify-between text-sm font-extrabold">
            <span>16 회 해지 시 최종 순손익:</span>
            <span class="${netProfitAt16 >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${netProfitAt16 >= 0 ? '+' : ''}${Math.round(netProfitAt16).toLocaleString()}원</span>
          </div>
        </div>

        <div>
          <h4 class="font-bold text-slate-800 mb-2">1~15 회차 월별 수수료 지급 내역</h4>
          <div class="space-y-1 max-h-[160px] overflow-y-auto custom-scrollbar text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
            ${monthlyCommRows}
          </div>
        </div>

        <div>
          <h4 class="font-bold text-slate-800 mb-2">적용된 시책 상세</h4>
          <div class="space-y-1 max-h-[120px] overflow-y-auto custom-scrollbar text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
            ${promoRows}
          </div>
        </div>
      </div>
    `;

    this.detailModalTitle.textContent = `자기계약 수지분석 상세 — ${c.title}`;
    this.detailModalBody.innerHTML = htmlContent;
    this.detailModal.classList.add('hidden');
    lucide.createIcons();
  }

  addPromoRow(promo = null) {
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2 bg-white p-2.5 rounded-lg border border-emerald-200 promo-row';
    div.innerHTML = `
      <select class="promo-type px-2 py-1.5 bg-slate-50 border border-slate-300 rounded text-xs">
        <option value="percent">월초 대비 (%)</option>
        <option value="amount">고정 금액 (원)</option>
      </select>
      <input type="number" class="promo-value px-2 py-1.5 bg-slate-50 border border-slate-300 rounded text-xs w-24" placeholder="수치" value="${promo ? promo.value : ''}">
      <input type="number" class="promo-month px-2 py-1.5 bg-slate-50 border border-slate-300 rounded text-xs w-28" placeholder="납입회차" value="${promo ? promo.afterPaymentMonth : 1}" min="1" max="60" title="N 회차 납입 후 익월 지급">
      <span class="text-[10px] text-slate-500 whitespace-nowrap">회차 납입 후 익월</span>
      <button type="button" onclick="this.closest('.promo-row').remove()" class="ml-auto text-rose-500 hover:text-rose-700 p-1">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
    `;
    this.promotionsContainer.appendChild(div);
    if (promo && promo.type) {
      div.querySelector('.promo-type').value = promo.type;
    }
    lucide.createIcons();
  }

  openModal(contractId = null) {
    this.contractForm.reset();
    this.promotionsContainer.innerHTML = '';
    document.getElementById('form-id').value = '';
    this.terminationWrapper.classList.add('hidden');

    if (contractId) {
      const contract = this.contracts.find(c => c.id === contractId);
      if (contract) {
        this.modalTitle.textContent = '보험계약 수정 (상태 및 환수 관리)';
        document.getElementById('form-id').value = contract.id;
        
        const radios = this.contractForm.elements['contractType'];
        for (let r of radios) {
          r.checked = (r.value === contract.contractType);
        }

        document.getElementById('form-status').value = contract.status || '정상유지';
        if (contract.status === '해지' || contract.status === '실효') {
          this.terminationWrapper.classList.remove('hidden');
          document.getElementById('form-terminationMonth').value = contract.terminationMonth || 6;
        }

        document.getElementById('form-productGroup').value = contract.productGroup || '건강/상해보험';
        document.getElementById('form-client').value = contract.client || '';
        document.getElementById('form-company').value = contract.company || '삼성생명';
        document.getElementById('form-title').value = contract.title || '';
        document.getElementById('form-startDate').value = contract.startDate || '';
        document.getElementById('form-premium').value = contract.premium || '';
        document.getElementById('form-paymentYears').value = contract.paymentYears || 20;
        document.getElementById('form-tp').value = contract.tp || 0;
        document.getElementById('form-surrenderValue16').value = contract.surrenderValue16 || 0;
        document.getElementById('form-memo').value = contract.memo || '';

        if (contract.promotions && contract.promotions.length > 0) {
          contract.promotions.forEach(p => this.addPromoRow(p));
        } else {
          this.addPromoRow({ type: 'percent', value: 0, afterPaymentMonth: 1 });
        }
      }
    } else {
      this.modalTitle.textContent = '새 보험계약 등록 (상태 및 환수 관리)';
      document.getElementById('form-startDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('form-productGroup').value = '건강/상해보험';
      document.getElementById('form-paymentYears').value = 20;
      document.getElementById('form-status').value = '정상유지';
      this.addPromoRow({ type: 'percent', value: 300, afterPaymentMonth: 1 });
    }

    this.modal.classList.remove('hidden');
    lucide.createIcons();
  }

  closeModal() {
    this.modal.classList.add('hidden');
  }

  async handleFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('form-id').value;

    const promoRows = this.promotionsContainer.querySelectorAll('.promo-row');
    const promotions = [];
    promoRows.forEach(row => {
      promotions.push({
        type: row.querySelector('.promo-type').value,
        value: Number(row.querySelector('.promo-value').value) || 0,
        afterPaymentMonth: Number(row.querySelector('.promo-month').value) || 1
      });
    });

    const status = document.getElementById('form-status').value;

    const contractData = {
      contractType: this.contractForm.elements['contractType'].value,
      status: status,
      terminationMonth: (status === '해지' || status === '실효') ? (Number(document.getElementById('form-terminationMonth').value) || 6) : 0,
      productGroup: document.getElementById('form-productGroup').value,
      client: document.getElementById('form-client').value.trim(),
      company: document.getElementById('form-company').value.trim(),
      title: document.getElementById('form-title').value.trim(),
      startDate: document.getElementById('form-startDate').value,
      premium: Number(document.getElementById('form-premium').value) || 0,
      paymentYears: Number(document.getElementById('form-paymentYears').value) || 20,
      tp: Number(document.getElementById('form-tp').value) || 0,
      surrenderValue16: Number(document.getElementById('form-surrenderValue16').value) || 0,
      promotions: promotions,
      memo: document.getElementById('form-memo').value.trim()
    };

    console.log('Saving contract data:', contractData);

    try {
      if (id) {
        contractData.id = id;
        await ContractStore.updateContractToSupabase(contractData);
      } else {
        await ContractStore.addContractToSupabase(contractData);
      }
      alert('데이터가 Supabase 에 저장되었습니다.');
      this.contracts = await ContractStore.getContractsFromSupabase();
      this.closeModal();
      this.renderAll();
    } catch (e) {
      console.error('Save error:', e);
      alert('저장 실패: ' + e.message);
    }
  }

  async deleteContract(id) {
    if (confirm('해당 계약 항목을 삭제하시겠습니까?')) {
      try {
        await ContractStore.deleteContractFromSupabase(id);
        alert('데이터가 Supabase 에서 삭제되었습니다.');
        this.contracts = await ContractStore.getContractsFromSupabase();
        this.renderAll();
      } catch (e) {
        alert('삭제 실패: ' + e.message);
      }
    }
  }

  exportData() {
    const jsonStr = JSON.stringify(this.contracts, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gfc_premium_manager_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (Array.isArray(imported)) {
          ContractStore.saveContracts(imported);
          this.contracts = imported;
          this.renderAll();
          alert('성공적으로 데이터를 불러왔습니다.');
        } else {
          alert('올바르지 않은 JSON 데이터 형식입니다.');
        }
      } catch (err) {
        alert('파일을 읽는 중 오류가 발생했습니다: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }
}

// Global App Instance
let app = null;

document.addEventListener('DOMContentLoaded', () => {
  app = new AppUI();
});