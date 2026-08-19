/**
 * GFC Premium Manager - Samsung Life GFC Planner System
 * Features: Manual Club Tier Selection (9 tiers including 30 만 Club),
 * Senior Performance Bonuses (Club & Achievement), New Planner Support,
 * Multi-promotions, 16th month surrender values, and Employment Insurance deductions.
 * Updated with Independent Monthly TP Calculation, Detailed Multi-month Cashflow & Self Analysis.
 */

// --- Data Model & Storage (Supabase 전용) ---
class ContractStore {
  static async getSettings() {
    const user = await this.checkAuth();
    if (!user) return { joinDate: '2025-01', clubTier: 'club_350' };

    const { data, error } = await window.supabase
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .single();
    if (error) console.error('Supabase 설정 로드 에러:', error);
    return (data && data.settings) ? data.settings : { joinDate: '2025-01', clubTier: 'club_350' };
  }

  static async saveSettings(settings) {
    const user = await this.checkAuth();
    if (!user) throw new Error('로그인이 필요합니다.');

    const { error } = await window.supabase
      .from('profiles')
      .upsert({ id: user.id, settings: settings });

    if (error) {
      console.error('Supabase settings save error:', error);
      throw new Error('Supabase 설정 저장 실패: ' + error.message);
    }
  }

  // 인증 상태 관리
  static async checkAuth() {
    try {
      const { data, error } = await window.supabase.auth.getUser();
      // persistSession:false 설정에서는 페이지를 열 때마다 저장된 세션이 없는 상태로 시작하는데,
      // 이 경우 Supabase가 "Auth session missing" 오류를 반환하는 게 알려진 정상 동작이다.
      // 이건 실제 오류가 아니라 "아직 로그인 안 한 상태"이므로 조용히 null(로그아웃 상태)로 처리한다.
      if (error) return null;
      return data ? data.user : null;
    } catch (e) {
      return null;
    }
  }

  // 아이디(이메일 @ 앞부분)만으로 전체 이메일을 찾기 위한 조회 (user_lookup 테이블, 비로그인 상태에서도 조회 가능해야 함)
  static async lookupEmailByUsername(username) {
    if (!window.supabase || !username) return null;
    try {
      const { data, error } = await window.supabase
        .from('user_lookup')
        .select('email')
        .eq('username', username)
        .maybeSingle();
      if (error || !data) return null;
      return data.email;
    } catch (e) {
      return null; // user_lookup 테이블이 아직 없는 경우 등 — 조용히 실패 처리
    }
  }

  // 로그인 성공 시 아이디→이메일 매핑을 자동으로 등록/갱신 (다음부터 아이디만으로 로그인 가능하게)
  static async registerUsernameLookup(user) {
    if (!window.supabase || !user || !user.email) return;
    const username = user.email.split('@')[0];
    try {
      await window.supabase
        .from('user_lookup')
        .upsert({ username, email: user.email, user_id: user.id });
    } catch (e) {
      console.error('아이디 조회용 정보 등록 실패 (user_lookup 테이블이 없을 수 있음):', e);
    }
  }

  static async login(email, password) {
    if (!email || !password) {
      throw new Error('이메일과 비밀번호를 모두 입력해주세요.');
    }
    if (!window.supabase) {
      console.error('Supabase 객체 없음:', window.supabase);
      throw new Error('Supabase가 초기화되지 않았습니다.');
    }
    const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  static async signup(email, password) {
    if (!email || !password) {
      throw new Error('이메일과 비밀번호를 모두 입력해주세요.');
    }
    if (!window.supabase) {
      console.error('Supabase 객체 없음:', window.supabase);
      throw new Error('Supabase가 초기화되지 않았습니다.');
    }
    const { data, error } = await window.supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  static async logout() {
    if (window.supabase) {
      await window.supabase.auth.signOut();
    }
  }

  // Supabase row(snake_case) -> 앱 내부 모델(camelCase) 변환
  static mapFromDb(row) {
    if (!row) return row;
    return {
      id: row.id,
      userId: row.user_id,
      createdAt: row.created_at,
      contractType: row.contract_type,
      status: row.status,
      terminationMonth: row.termination_month,
      productGroup: row.product_group,
      client: row.client,
      company: row.company,
      title: row.title,
      startDate: row.start_date,
      premium: row.premium,
      paymentYears: row.payment_years,
      tp: row.tp,
      surrenderValue16: row.surrender_value_16,
      promotions: row.promotions || [],
      memo: row.memo,
      isDeleted: !!row.is_deleted,
      deletedAt: row.deleted_at
    };
  }

  // Supabase 연동 메서드 (사용자별 데이터 필터링, 소프트 삭제된 계약은 제외)
  static async getContractsFromSupabase() {
    const user = await this.checkAuth();
    if (!user) return [];

    const { data, error } = await window.supabase
      .from('contracts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_deleted', false);
    
    if (error) {
      console.error('Supabase 데이터 로드 에러:', error);
      return [];
    }
    return (data || []).map(row => this.mapFromDb(row));
  }

  // 최근 소프트 삭제한 계약 목록 (다시 불러오기 UI용, DB에 영구 보관되므로 세션/새로고침과 무관하게 유지)
  static async getRecentlyDeletedFromSupabase(limit = 10) {
    const user = await this.checkAuth();
    if (!user) return [];

    const { data, error } = await window.supabase
      .from('contracts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_deleted', true)
      .order('deleted_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('삭제된 계약 목록 로드 에러:', error);
      return [];
    }
    return (data || []).map(row => this.mapFromDb(row));
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

  // Supabase 연동 메서드들
  static async addContractToSupabase(contract) {
    const user = await this.checkAuth();
    if (!user) throw new Error('로그인이 필요합니다.');
    
    // 데이터 정제: undefined/null 값 제거 및 타입 변환
    const contractToSave = {
      user_id: user.id,
      created_at: new Date().toISOString(),
      contract_type: contract.contractType || '진성계약',
      status: contract.status || '정상유지',
      termination_month: Number(contract.terminationMonth) || 0,
      product_group: contract.productGroup || '건강/상해보험',
      client: contract.client || '',
      company: contract.company || '삼성생명',
      title: contract.title || '',
      start_date: contract.startDate || new Date().toISOString().split('T')[0],
      premium: Number(contract.premium) || 0,
      payment_years: Number(contract.paymentYears) || 20,
      tp: Number(contract.tp) || 0,
      surrender_value_16: Number(contract.surrenderValue16) || 0,
      promotions: contract.promotions || [],
      memo: contract.memo || ''
    };
    
    console.log('Supabase insert payload:', contractToSave);
    
    const { data, error } = await window.supabase
      .from('contracts')
      .insert([contractToSave])
      .select();
    
    if (error) {
      console.error('Supabase insert error details:', error);
      throw new Error('계약 저장 실패: ' + error.message);
    }
    return this.mapFromDb(data[0]);
  }

  static async updateContractToSupabase(contract) {
    const user = await this.checkAuth();
    if (!user) throw new Error('로그인이 필요합니다.');
    
    const contractToUpdate = {
      contract_type: contract.contractType,
      status: contract.status,
      termination_month: contract.terminationMonth,
      product_group: contract.productGroup,
      client: contract.client,
      company: contract.company,
      title: contract.title,
      start_date: contract.startDate,
      premium: contract.premium,
      payment_years: contract.paymentYears,
      tp: contract.tp,
      surrender_value_16: contract.surrenderValue16,
      promotions: contract.promotions,
      memo: contract.memo
    };

    const { data, error } = await window.supabase
      .from('contracts')
      .update(contractToUpdate)
      .eq('id', contract.id)
      .eq('user_id', user.id)
      .select();
    
    if (error) throw error;
    return this.mapFromDb(data[0]);
  }

  // 소프트 삭제: 실제로 행을 지우지 않고 is_deleted/deleted_at만 표시.
  // DB에는 그대로 남아있으므로 대시보드·계산 로직에서만 제외되고, 이후 언제든 restoreContractInSupabase로 복원 가능.
  static async deleteContractFromSupabase(id) {
    const user = await this.checkAuth();
    if (!user) throw new Error('로그인이 필요합니다.');

    const { error } = await window.supabase
      .from('contracts')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;
  }

  // 소프트 삭제된 계약을 원래 상태로 복원 (같은 id 그대로 되살림)
  static async restoreContractInSupabase(id) {
    const user = await this.checkAuth();
    if (!user) throw new Error('로그인이 필요합니다.');

    const { error } = await window.supabase
      .from('contracts')
      .update({ is_deleted: false, deleted_at: null })
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;
  }

  // 완전 삭제: 소프트 삭제 목록에서 행 자체를 영구적으로 제거. 복원 불가능하므로 신중히 사용.
  static async permanentlyDeleteContract(id) {
    const user = await this.checkAuth();
    if (!user) throw new Error('로그인이 필요합니다.');

    const { error } = await window.supabase
      .from('contracts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('is_deleted', true); // 소프트 삭제 상태인 계약만 완전 삭제 가능 (안전장치)

    if (error) throw error;
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

  // 두 날짜 사이의 개월 수 차이 (a가 b보다 이전이면 음수)
  static monthDiff(a, b) {
    return (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
  }

  // 첫 계약 시작월(또는 등록일) 중 가장 이른 달을 반환. 데이터가 없으면 오늘.
  static getEarliestRelevantMonth(contracts, joinDateStr) {
    const today = new Date();
    let earliest = new Date(today.getFullYear(), today.getMonth(), 1);

    if (joinDateStr) {
      const [jY, jM] = joinDateStr.split('-').map(Number);
      if (jY && jM) {
        const joinDate = new Date(jY, jM - 1, 1);
        if (joinDate < earliest) earliest = joinDate;
      }
    }

    (contracts || []).forEach(c => {
      if (!c.startDate) return;
      const d = new Date(c.startDate);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      if (monthStart < earliest) earliest = monthStart;
    });

    return earliest;
  }

  // Club 등급별 기준액 (원 단위, 높은 순) — 자동 등급 추정 및 문턱효과 판정에 공용으로 사용
  static CLUB_TIERS = [
    { key: 'club_350', name: '프레스티지 명인(명인P)', threshold: 3500000 },
    { key: 'club_230', name: '명인 Club', threshold: 2300000 },
    { key: 'club_150', name: '150만 Club', threshold: 1500000 },
    { key: 'club_100', name: '100만 Club', threshold: 1000000 },
    { key: 'club_70', name: '70만 Club', threshold: 700000 },
    { key: 'club_50', name: '50만 Club', threshold: 500000 },
    { key: 'club_30', name: '30만 Club', threshold: 300000 }
  ];

  static getTierForTP(tp) {
    for (const t of this.CLUB_TIERS) {
      if (tp >= t.threshold) return t;
    }
    return { key: 'consultant', name: '일반 컨설턴트(무 Club)', threshold: 0 };
  }

  // 최근 N개월(기본 3개월) 평균 TP를 기준으로 Club 등급을 자동 추정.
  // 실제 심사는 분기(1,4,7,10월)마다 직전 3개월 또는 6개월 실적으로 이뤄지고 그 기준월 수도
  // 현재 등급에 따라 달라지는 등 더 복잡하지만, 이 앱에서는 매달 갱신되는 "최근 3개월 평균" 추정치로 단순화.
  static estimateClubTier(contracts, targetDate, months = 3) {
    let total = 0;
    for (let i = 0; i < months; i++) {
      const d = new Date(targetDate.getFullYear(), targetDate.getMonth() - i, 1);
      let monthTP = 0;
      (contracts || []).forEach(c => {
        const sd = new Date(c.startDate);
        if (sd.getFullYear() === d.getFullYear() && sd.getMonth() === d.getMonth()) {
          monthTP += Number(c.tp) || 0;
        }
      });
      total += monthTP;
    }
    const avgTP = total / months;
    const tier = this.getTierForTP(avgTP);
    return { avgTP: Math.round(avgTP), tierKey: tier.key, tierName: tier.name };
  }

  static getClubBonusParams(clubTierKey) {
    switch (clubTierKey) {
      case 'consultant': return { name: '일반 컨설턴트 (무 Club)', rate: 0 };
      case 'club_30': return { name: '30 만 Club', rate: 0.20 };
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

  // 정착수수료 (1~11차월만 지급) — 신계약수수료와 동일한 환수율표(COMMISSION_CLAWBACK_TABLE) 적용 대상
  static getSettlementFee(tenureMonth, monthlyTP) {
    if (tenureMonth > 11 || monthlyTP <= 0) return 0;
    if (monthlyTP >= 700000) return 2300000;
    if (monthlyTP >= 500000) return 2100000;
    if (monthlyTP >= 300000) return 1500000;
    return 500000;
  }

  // 신인성과보너스 (1~24차월) — 별도의 전용 환수율표(NEW_PLANNER_BONUS_CLAWBACK_TABLE) 적용 대상
  static getNewPlannerPerformanceBonus(tenureMonth, monthlyTP) {
    if (tenureMonth > 24 || monthlyTP <= 0) return 0;
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
    return Math.round(perfBonus);
  }

  // 정착수수료 + 신인성과보너스 합계 (지원금 총액 표시 등, 클로백이 필요 없는 곳에서 사용)
  static getNewPlannerSupport(tenureMonth, monthlyTP) {
    return this.getSettlementFee(tenureMonth, monthlyTP) + this.getNewPlannerPerformanceBonus(tenureMonth, monthlyTP);
  }

  // 계약이 특정 시점(targetDate)에 정상적으로 유지되고 있는지 판단 (해지/실효라면 해지월 이전까지만 유지로 봄)
  static isContractMaintainedAt(contract, targetDate) {
    const startDate = new Date(contract.startDate);
    const elapsedMonths = (targetDate.getFullYear() - startDate.getFullYear()) * 12 + (targetDate.getMonth() - startDate.getMonth());
    if (elapsedMonths < 0) return false;
    const status = contract.status || '정상유지';
    if (status !== '해지' && status !== '실효') return true;
    const terminationMonth = Number(contract.terminationMonth) || 6;
    return elapsedMonths < terminationMonth;
  }

  // 신인 유지보너스 (규정집 "4.신인수수료 > 신인 유지보너스"): 신인 1~11차월에 모집한 계약 중
  // 대상월 현재까지 유지 중인 계약들의 TP 합계 × 위촉 13~18차월별 지급률, 월 지급 한도 300만원
  static getRetentionBonusRate(tenureMonth) {
    if (tenureMonth === 13) return 20;
    if (tenureMonth === 14) return 30;
    if (tenureMonth >= 15 && tenureMonth <= 18) return 40;
    return 0;
  }

  static calculateRetentionBonus(contracts, joinDateStr, targetDate) {
    const tenureMonth = this.calculateTenureMonth(joinDateStr, targetDate);
    const rate = this.getRetentionBonusRate(tenureMonth);
    if (rate <= 0) return 0;

    let maintainedTP = 0;
    contracts.forEach(c => {
      const startDate = new Date(c.startDate);
      const regTenure = this.calculateTenureMonth(joinDateStr, startDate);
      if (regTenure < 1 || regTenure > 11) return; // 신인 1~11차월에 모집한 계약만 대상
      if (this.isContractMaintainedAt(c, targetDate)) {
        maintainedTP += (Number(c.tp) || 0);
      }
    });

    const bonus = maintainedTP * (rate / 100);
    return Math.min(Math.round(bonus), 3000000); // 월 지급 한도 300만원
  }

  // 신인성과보너스 회차별 환수율 (%) — 규정집 "3.신인성과보너스 > 환수기준" 표
  static NEW_PLANNER_BONUS_CLAWBACK_TABLE = {
    2: 100, 3: 95, 4: 89, 5: 84, 6: 78, 7: 73, 8: 68, 9: 62,
    10: 57, 11: 52, 12: 46, 13: 41, 14: 35, 15: 30
  };

  // 정착수수료·신인성과보너스 개별계약 환수 (구조변경): 이 두 지원금은 "그 달 신규계약 TP 합계"를
  // 기준으로 월 단위로 지급되기 때문에, 특정 계약 하나가 나중에 해지되면 그 계약이 원래 지급월의
  // 보너스에서 차지했던 TP 비중(pro-rata)만큼을 그 계약의 "귀속 보너스"로 보고, 해당 계약의 미유지
  // 회차별 환수율을 적용해 환수액을 계산한다. 정착수수료는 신계약수수료와 동일한 환수율표를,
  // 신인성과보너스는 전용 환수율표를 각각 따로 적용한다 (규정집상 서로 다른 표).
  // (regulation에 개별계약 배분 방식이 명시되어 있지 않아 TP 비례 배분으로 추정 구현)
  static calculateNewPlannerBonusClawback(contracts, joinDateStr, targetDate) {
    let totalClawback = 0;

    contracts.forEach(contract => {
      const status = contract.status || '정상유지';
      if (status !== '해지' && status !== '실효') return;

      const terminationMonth = Number(contract.terminationMonth) || 6;
      const startDate = new Date(contract.startDate);
      const elapsedAtTarget = (targetDate.getFullYear() - startDate.getFullYear()) * 12 + (targetDate.getMonth() - startDate.getMonth());
      if (elapsedAtTarget !== terminationMonth) return; // 이번 달에 해지/실효가 발생한 계약만 처리

      const terminationRound = terminationMonth + 1; // elapsedMonths(0-based) → 회차(1-based)
      const settlementClawbackRate = this.COMMISSION_CLAWBACK_TABLE[terminationRound] || 0;
      const performanceClawbackRate = this.NEW_PLANNER_BONUS_CLAWBACK_TABLE[terminationRound] || 0;
      if (settlementClawbackRate <= 0 && performanceClawbackRate <= 0) return;

      const regTenure = this.calculateTenureMonth(joinDateStr, startDate);
      if (regTenure > 24) return; // 시니어 시절 등록된 계약은 신인성과보너스 대상이 아님

      // 이 계약이 등록됐던 달의 신규계약 TP 합계를 재계산
      let regMonthTotalTP = 0;
      contracts.forEach(other => {
        const otherStart = new Date(other.startDate);
        if (otherStart.getFullYear() === startDate.getFullYear() && otherStart.getMonth() === startDate.getMonth()) {
          regMonthTotalTP += (Number(other.tp) || 0);
        }
      });
      if (regMonthTotalTP <= 0) return;

      const myShare = (Number(contract.tp) || 0) / regMonthTotalTP;
      const originalSettlement = this.getSettlementFee(regTenure, regMonthTotalTP);
      const originalPerformance = this.getNewPlannerPerformanceBonus(regTenure, regMonthTotalTP);

      totalClawback += Math.round(originalSettlement * myShare * (settlementClawbackRate / 100));
      totalClawback += Math.round(originalPerformance * myShare * (performanceClawbackRate / 100));
    });

    return totalClawback;
  }

  // 회차별 수수료 환수율 (%) — 규정집 "3.계약관련 수수료 > 신계약수수료 ①초회분 미유지時 회차별 환수율" 원문 수치
  static COMMISSION_CLAWBACK_TABLE = {
    2: 100, 3: 100, 4: 92, 5: 84, 6: 76, 7: 68, 8: 60, 9: 52,
    10: 44, 11: 36, 12: 28, 13: 21, 14: 14, 15: 7
  };

  // 계약관리 보너스 (13~60회차, 규정집 "3.계약관련 수수료 > 계약관리 보너스" 표)
  // 신계약수수료(1~15회)와 별개로 병행 지급되는 장기유지 수수료
  static getManagementBonusRate(productGroup, elapsedMonths) {
    const round = elapsedMonths + 1; // elapsedMonths(0-based) → 회차(1-based)
    if (round < 13 || round > 60) return 0;

    if (productGroup === '종신/GI 보험') {
      if (round <= 24) return 14;
      if (round <= 36) return 11;
      return 0; // 37~60회 미지급
    }
    if (productGroup === '건강/상해보험') {
      if (round <= 24) return 4;
      if (round <= 36) return 3;
      return 0; // 37~60회 미지급
    }
    // 연금/저축성보험 (금융형)
    if (round <= 24) return 11;
    if (round <= 36) return 8;
    return 3; // 37~60회 3%
  }

  // 신계약수수료(1~15회) + 계약관리보너스(13~60회)를 합산한 회차별 총 수수료율(%)
  static getCombinedCommissionRate(productGroup, elapsedMonths, feeRates) {
    let rate = 0;
    if (elapsedMonths >= 0 && elapsedMonths < 15) {
      rate += feeRates[elapsedMonths] || 0;
    }
    rate += this.getManagementBonusRate(productGroup, elapsedMonths);
    return rate;
  }

  // 1~15회차까지 발생하는 총 수수료(신계약수수료 + 13~15회 계약관리보너스)
  // 자기계약 "16회차 해지 수지분석"에서 공용으로 사용
  static calculateTotalCommissionThrough15Rounds(contract, feeRates) {
    const premium = Number(contract.premium) || 0;
    const tp = Number(contract.tp) || 0;
    let total = 0;
    for (let elapsed = 0; elapsed < 15; elapsed++) {
      const rate = this.getCombinedCommissionRate(contract.productGroup, elapsed, feeRates);
      total += tp * (rate / 100);
    }
    return total;
  }

  // 프로모션 데이터 정규화: { name, payouts:[{type,value,afterPaymentMonth}, ...] } 형태로 통일.
  // 구버전 데이터({type,value,afterPaymentMonth}가 최상위에 바로 있는 형태)도 그대로 지원한다.
  static normalizePromotions(promotions) {
    if (!Array.isArray(promotions)) return [];
    return promotions.map((p, idx) => {
      if (p && Array.isArray(p.payouts)) {
        return { name: p.name || `프로모션 ${idx + 1}`, payouts: p.payouts };
      }
      return { name: (p && p.name) || `프로모션 ${idx + 1}`, payouts: [{ type: p.type, value: p.value, afterPaymentMonth: p.afterPaymentMonth }] };
    });
  }

  // 계산에는 그룹명이 필요 없으므로, 모든 프로모션 그룹의 payouts만 하나의 배열로 평탄화
  static flattenPromotionPayouts(promotions) {
    return this.normalizePromotions(promotions).flatMap(g => g.payouts.map(p => ({ ...p, groupName: g.name })));
  }

  // 특정 계약(c)의 TP가 그 달 신규TP 합계에 더해짐으로써 늘어난 신인/시니어 지원금 증분을 계산.
  // 같은 달에 시작된 계약들을 등록 순서(createdAt)대로 정렬해 누적 TP를 쌓아가면서,
  // "먼저 등록된 계약이 이미 확보한 지원금은 그대로 유지되고, 나중에 추가된 계약은
  //  그로 인해 새로 늘어난 한계 기여분만 가져가도록" 배분한다.
  // (예전 방식은 "나를 뺀 나머지 TP"와 단순 비교했는데, 두 계약이 같은 문턱값 구간을 나눠 가지면
  //  먼저 등록된 계약 쪽 지원금이 거꾸로 줄어드는 등 배분이 꼬이는 문제가 있었음.
  //  이 방식은 항상 각 계약의 몫을 합치면 정확히 전체 지원금과 일치한다.)
  static calculateAttributedTPBonus(contract, allContracts, joinDateStr, clubKey) {
    const startDate = new Date(contract.startDate);
    const tenureMonth = this.calculateTenureMonth(joinDateStr, startDate);
    const myTP = Number(contract.tp) || 0;
    if (myTP <= 0) return 0;

    const sameMonthContracts = (allContracts || [])
      .filter(c => {
        const d = new Date(c.startDate);
        return d.getFullYear() === startDate.getFullYear() && d.getMonth() === startDate.getMonth();
      })
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (ta !== tb) return ta - tb;
        return String(a.id).localeCompare(String(b.id));
      });

    const calcBonus = (tp) => {
      if (tp <= 0) return 0;
      return tenureMonth <= 24
        ? this.getNewPlannerSupport(tenureMonth, tp)
        : this.calculateSeniorPerformanceBonus(tp, clubKey);
    };

    let cumulativeTP = 0;
    let bonusBefore = 0;
    let bonusAfter = 0;
    for (const c of sameMonthContracts) {
      const tp = Number(c.tp) || 0;
      const before = calcBonus(cumulativeTP);
      cumulativeTP += tp;
      const after = calcBonus(cumulativeTP);
      if (c.id === contract.id) {
        bonusBefore = before;
        bonusAfter = after;
        break;
      }
    }

    return Math.max(0, bonusAfter - bonusBefore);
  }

  // 16회차 해지(=15회 납입 후 해지, 25차월 미도달) 시나리오 전용: 그때까지 지급된
  // '건강상해보너스' 프로모션 전액에 70% 환수를 적용한 금액을 계산
  // 16회차 해지(=15회 납입 후 해지) 시나리오 전용. 건강상해 건수 보너스의 공식 환수율표(14~25회차)에서
  // 16회차 미유지에 해당하는 값(70%)을 그대로 사용 — calculateMonthlySchedule의 HEALTH_BONUS_CLAWBACK_TABLE과 동일 출처.
  static calculateHealthBonusClawback(contract, uptoRound = 15) {
    const premium = Number(contract.premium) || 0;
    let total = 0;
    this.flattenPromotionPayouts(contract.promotions).forEach(p => {
      if ((p.groupName || '').trim() !== '건강상해보너스') return;
      const round = Number(p.afterPaymentMonth) || 1;
      if (round <= uptoRound) {
        const val = Number(p.value) || 0;
        total += (p.type === 'percent' ? premium * (val / 100) : val);
      }
    });
    return Math.round(total * 0.70);
  }

  // '건강상해보너스' 이외의 모든 프로모션(상품프로모션/지점지원금/직접입력 등) 공통 환수 규칙:
  // 프로모션 명칭과 무관하게, 지급 시기(afterPaymentMonth)가 13회차 이후이고 25회차 이전에 해지되면
  // 그때까지 지급된 해당 프로모션 금액의 70%를 일괄 환수한다. (건강상해보너스는 자체 14~25회 환수율표를 그대로 유지)
  static calculateGeneralPromoClawback(contract, uptoRound = 15) {
    const terminationRound = uptoRound + 1; // uptoRound까지 납입 후 해지 = 해지(미유지) 회차
    if (terminationRound >= 25) return 0; // 25회차 이후 해지는 이 규칙 대상 아님
    const premium = Number(contract.premium) || 0;
    let total = 0;
    this.flattenPromotionPayouts(contract.promotions).forEach(p => {
      if ((p.groupName || '').trim() === '건강상해보너스') return; // 건강상해보너스는 전용 규칙 사용, 중복 환수 방지
      const round = Number(p.afterPaymentMonth) || 1;
      if (round >= 13 && round <= uptoRound) {
        const val = Number(p.value) || 0;
        total += (p.type === 'percent' ? premium * (val / 100) : val);
      }
    });
    return Math.round(total * 0.70);
  }

  // 자기계약 등록/수정 시 "16회차 해지를 전제로 이 계약을 하는 게 유리한가"를 판단.
  // 계약 자체의 손익(수수료+프로모션-지출+해약환급금-환수)뿐 아니라, 이 계약의 TP가 그 달 다른
  // 계약들과 합쳐지면서 신인/시니어 지원금이 얼마나 더 늘어나는지(문턱효과)까지 함께 반영한다.
  // candidate.id가 allContracts 안에 이미 있으면(수정 중인 기존 계약) 자기 자신은 제외하고 계산.
  static evaluateSelfContractDecision(candidateRaw, allContracts, joinDateStr, clubKey) {
    const startDate = new Date(candidateRaw.startDate);
    if (!candidateRaw.startDate || isNaN(startDate.getTime())) return null;

    const premium = Number(candidateRaw.premium) || 0;
    const tp = Number(candidateRaw.tp) || 0;
    if (premium <= 0 || tp <= 0) return null;

    // 이 계약이 아직 등록 전(신규)이라면, TP 문턱효과 계산에서 항상 "마지막에 추가된 계약"으로
    // 취급되도록 최신 시각을 부여한다 (그래야 기존 계약들이 이미 확보한 몫을 가로채지 않음).
    const candidate = { ...candidateRaw, createdAt: candidateRaw.createdAt || new Date().toISOString() };
    const others = (allContracts || []).filter(c => c.id !== candidate.id);

    const isSenior = this.calculateTenureMonth(joinDateStr, startDate) > 24;
    const surrender16 = Number(candidate.surrenderValue16) || 0;

    const feeRates = this.getFeeSchedule(candidate.productGroup, isSenior);
    const totalComm = this.calculateTotalCommissionThrough15Rounds(candidate, feeRates);
    const totalPromoCalc = this.flattenPromotionPayouts(candidate.promotions).reduce((sum, p) => {
      const val = Number(p.value) || 0;
      return sum + (p.type === 'percent' ? premium * (val / 100) : val);
    }, 0);
    const totalGross = totalComm + totalPromoCalc;
    const totalIncomeNet = totalGross * (1 - 0.008);
    const totalExpense15 = premium * 15;
    const tpBonusDiff = this.calculateAttributedTPBonus(candidate, [...others, candidate], joinDateStr, clubKey);
    const healthBonusClawback = this.calculateHealthBonusClawback(candidate, 15);
    const generalPromoClawback = this.calculateGeneralPromoClawback(candidate, 15);
    const netProfitAt16 = totalIncomeNet + surrender16 - totalExpense15 + tpBonusDiff - healthBonusClawback - generalPromoClawback;

    // TP 문턱효과: 이 계약을 제외/포함했을 때 그 달 신인/시니어 지원금 비교 (판단 근거 표시용)
    let otherTP = 0;
    others.forEach(c => {
      const d = new Date(c.startDate);
      if (d.getFullYear() === startDate.getFullYear() && d.getMonth() === startDate.getMonth()) {
        otherTP += (Number(c.tp) || 0);
      }
    });
    const tenureMonth = this.calculateTenureMonth(joinDateStr, startDate);
    const bonusWithout = tenureMonth <= 24 ? this.getNewPlannerSupport(tenureMonth, otherTP) : this.calculateSeniorPerformanceBonus(otherTP, clubKey);
    const bonusWith = tenureMonth <= 24 ? this.getNewPlannerSupport(tenureMonth, otherTP + tp) : this.calculateSeniorPerformanceBonus(otherTP + tp, clubKey);

    // 30만 TP는 GFC 활동 유지의 최소 기준선이자, 연속 3개월 미달 시 업적분/성과보너스 자체가 끊기는
    // 문턱값이라 단순 금액 이상의 의미가 있음. 이 계약이 없으면 이번 달 30만에 못 미치는지 확인.
    const monthTP = otherTP + tp;
    const essentialFor30 = otherTP < 300000 && monthTP >= 300000;
    const stillBelow30 = monthTP < 300000;

    // 이 계약으로 새로 넘어서는 Club 등급 문턱(들)을 확인 — 단순 지원금 액수뿐 아니라
    // Club 등급 자체를 유지/승급하는 데 필요한 계약인지 판단하기 위함
    const crossedTiers = this.CLUB_TIERS.filter(t => otherTP < t.threshold && monthTP >= t.threshold).map(t => t.name);
    const currentClubThreshold = (this.CLUB_TIERS.find(t => t.key === clubKey) || {}).threshold || 0;
    const essentialForCurrentClub = currentClubThreshold > 0 && otherTP < currentClubThreshold && monthTP >= currentClubThreshold;

    return {
      netProfitAt16: Math.round(netProfitAt16),
      totalIncomeNet: Math.round(totalIncomeNet),
      totalExpense15,
      surrender16,
      tpBonusDiff: Math.round(tpBonusDiff),
      healthBonusClawback,
      generalPromoClawback,
      otherTP,
      monthTP,
      bonusWithout: Math.round(bonusWithout),
      bonusWith: Math.round(bonusWith),
      essentialFor30,
      stillBelow30,
      crossedTiers,
      essentialForCurrentClub,
      verdict: netProfitAt16 >= 0 ? 'good' : 'bad'
    };
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

  static calculateMonthlySchedule(contract, horizonMonths = 24, joinDateStr = '2025-01', baseDate = null) {
    const schedule = [];
    const startDate = new Date(contract.startDate);
    const rangeStart = baseDate instanceof Date ? baseDate : new Date();

    const premium = Number(contract.premium) || 0;
    const tp = Number(contract.tp) || 0;
    // 신인/시니어 수수료 구조는 "계약 체결 시점"의 위촉차월 기준으로 고정된다.
    // (오늘 날짜나 예측 대상월 기준으로 계산하면, 실제로는 신인 구조로 체결된 과거 계약이
    //  플래너가 25차월을 넘긴 뒤에는 시니어 구조로 잘못 표시되는 오류가 생김)
    const isSenior = this.calculateTenureMonth(joinDateStr, startDate) > 24;
    const feeRates = this.getFeeSchedule(contract.productGroup, isSenior);
    const promotionPayouts = this.flattenPromotionPayouts(contract.promotions);
    const status = contract.status || '정상유지';
    const terminationMonth = Number(contract.terminationMonth) || 6;

    for (let m = 0; m < horizonMonths; m++) {
      const monthDate = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + m, 1);
      const elapsedMonths = (monthDate.getFullYear() - startDate.getFullYear()) * 12 + (monthDate.getMonth() - startDate.getMonth());
      
      let commissionIncome = 0;
      let promoIncome = 0;
      let premiumExpense = 0;
      let clawbackAmount = 0;

      const isTerminatedBeforeThisMonth = (status === '해지' || status === '실효') && (elapsedMonths >= terminationMonth);
      const isTerminatedThisMonth = (status === '해지' || status === '실효') && (elapsedMonths === terminationMonth);

      // 수수료는 "납입 시점"이 아니라 "납입 다음 달"에 지급된다 (규정집 프로모션 문구 "N회차 납입 후 익월 지급"과 동일한 원리).
      // 그래서 계약 시작월(elapsedMonths=0)에는 아직 지급될 수수료가 없고, 실제로는 1회차 납입분 수수료가
      // 다음 달(elapsedMonths=1)에 들어온다. incomeRoundIndex는 "이번 달에 지급되는 수수료가 몇 회차 납입분인지"를
      // feeRates 배열 인덱스(0-based)로 나타낸다.
      const incomeRoundIndex = elapsedMonths - 1;
      // 이번 달에 지급되는 수수료의 원천이 된 납입회차(incomeRoundIndex)가 실제로 해지 전에 납입되었는지 확인
      const incomeRoundWasNotPaid = (status === '해지' || status === '실효') && (incomeRoundIndex >= terminationMonth);

      if (incomeRoundIndex >= 0 && !incomeRoundWasNotPaid) {
        const rate = this.getCombinedCommissionRate(contract.productGroup, incomeRoundIndex, feeRates);
        commissionIncome = tp * (rate / 100);
      }

      // 프로모션도 "N회차 납입 후 익월 지급"이므로, 지급월(targetDepositMonth) 시점이 아니라 그 프로모션의
      // 근거가 된 납입회차(targetDepositMonth-1)가 실제로 해지 전에 납입되었는지로 게이팅해야 정확하다.
      // (기존엔 지급월 자체가 해지월 이후인지만 봐서, "해지 직전 회차 납입 후 익월 지급"인 프로모션이
      //  지급월이 하필 해지월과 같거나 그 이후로 계산되면 정상 지급분까지 누락되는 경우가 있었음)
      promotionPayouts.forEach(promo => {
        const targetDepositMonth = Number(promo.afterPaymentMonth) || 1;
        if (elapsedMonths === targetDepositMonth) {
          const promoPaymentRoundIndex = targetDepositMonth - 1;
          const promoRoundWasNotPaid = (status === '해지' || status === '실효') && (promoPaymentRoundIndex >= terminationMonth);
          if (!promoRoundWasNotPaid) {
            let pVal = Number(promo.value) || 0;
            let earnedPromo = promo.type === 'percent' ? premium * (pVal / 100) : pVal;
            promoIncome += earnedPromo;
          }
        }
      });

      // 건강상해 건수 보너스(=프로모션명 '건강상해보너스') 전용 환수율표 (14~25회차, 규정집 원문)
      const HEALTH_BONUS_CLAWBACK_TABLE = {
        14: 100, 15: 100, 16: 70, 17: 65, 18: 60, 19: 55,
        20: 50, 21: 45, 22: 40, 23: 35, 24: 30, 25: 30
      };

      if (isTerminatedThisMonth) {
        // (1) 프로모션 환수: '건강상해보너스'라는 이름의 프로모션에 한해, 25회 이내 미유지 시
        //     미유지회차(14~25회)별 환수율 적용 (건강상해 건수 보너스 전용 표, 신계약수수료 표와 다름)
        const healthClawbackRound = terminationMonth + 1;
        const healthClawbackRate = HEALTH_BONUS_CLAWBACK_TABLE[healthClawbackRound] || 0;
        if (healthClawbackRate > 0) {
          let totalPromoReceived = 0;
          promotionPayouts.forEach(promo => {
            if ((promo.groupName || '').trim() !== '건강상해보너스') return;
            const targetDepositMonth = Number(promo.afterPaymentMonth) || 1;
            if (targetDepositMonth <= terminationMonth) {
              let pVal = Number(promo.value) || 0;
              totalPromoReceived += (promo.type === 'percent' ? premium * (pVal / 100) : pVal);
            }
          });
          clawbackAmount += Math.round(totalPromoReceived * (healthClawbackRate / 100));
        }

        // (2) 신계약수수료 환수: "초회분"에만 회차별 환수율 적용 (이미 지급된 분급분·계약관리보너스는 환수 대상 아님 — 규정집 원문)
        const terminationRound = terminationMonth + 1; // elapsedMonths(0-based) → 회차(1-based)
        const clawbackRate = this.COMMISSION_CLAWBACK_TABLE[terminationRound] || 0;
        if (clawbackRate > 0) {
          const firstRoundRate = feeRates[0] || 0; // 초회분 요율만 (예: 종신/GI 112%, 건강상해 200%, 금융형 102%)
          const firstRoundCommission = tp * (firstRoundRate / 100);
          clawbackAmount += Math.round(firstRoundCommission * (clawbackRate / 100));
        }

        // (3) 그 외 프로모션(상품프로모션·지점지원금·직접입력 등) 공통 환수: 프로모션 명칭과 무관하게
        //     지급 회차가 13회차 이후이고 25회차 이전 해지 시, 그때까지 지급된 금액의 70%를 일괄 환수
        //     (건강상해보너스는 위 (1)의 전용 환수율표를 그대로 사용하므로 여기서는 제외해 중복 환수 방지)
        if (terminationRound < 25) {
          let totalGeneralPromoReceived = 0;
          promotionPayouts.forEach(promo => {
            if ((promo.groupName || '').trim() === '건강상해보너스') return;
            const targetDepositMonth = Number(promo.afterPaymentMonth) || 1;
            if (targetDepositMonth >= 13 && targetDepositMonth <= terminationMonth) {
              let pVal = Number(promo.value) || 0;
              totalGeneralPromoReceived += (promo.type === 'percent' ? premium * (pVal / 100) : pVal);
            }
          });
          clawbackAmount += Math.round(totalGeneralPromoReceived * 0.70);
        }
      }

      if (contract.contractType === '자기계약' && !isTerminatedBeforeThisMonth) {
        const paymentYears = Number(contract.paymentYears) || 20;
        const paymentMonths = paymentYears * 12;
        if (elapsedMonths >= 0 && elapsedMonths < paymentMonths) {
          premiumExpense = premium;
        }
      }

      const totalGrossIncome = commissionIncome + promoIncome - clawbackAmount;
      // 고용보험료 공제(0.8%)는 월 보수 80만원 이상일 때만 적용
      const employmentInsDeduction = totalGrossIncome >= 800000 ? Math.round(totalGrossIncome * 0.008) : 0;
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

  static calculateAggregatedCashflow(contracts, horizonMonths = 24, joinDateStr = '2025-01', clubKey = 'club_350', onlySelf = false, baseDate = null) {
    const rangeStart = baseDate instanceof Date ? baseDate : new Date();
    const result = Array.from({ length: horizonMonths }, (_, m) => {
      const targetDate = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + m, 1);
      // 신인/시니어 지원금(정착수수료·성과보너스·업적분·클럽분 등)도 계약 수수료와 동일하게
      // "이번 달 실적"이 아니라 "지난 달 실적"을 기준으로 이번 달에 지급된다 (익월 지급 원칙).
      // 그래서 계약이 막 시작된 바로 그 달에는 그 계약의 TP가 아직 지원금에 반영되지 않아야 하고,
      // 다음 달 지원금 계산에 반영되어야 한다.
      const productionDate = new Date(targetDate.getFullYear(), targetDate.getMonth() - 1, 1);

      // calculateTenureMonth는 위촉일 이전 날짜도 Math.max(1, ...) 클램프 때문에 "1차월"로 반환한다.
      // 그래서 등록월 이전(=아직 위촉 전) 시점을 그대로 넘기면 등록월 직전 달까지 "1차월"로 오인되어
      // GFC교육비(80만원) 등 신인 1차월 지원금이 등록월과 다음달 두 번 지급되는 버그가 있었다.
      // 실제 위촉일 이전이면 지원금 계산 자체를 건너뛴다.
      const [joinY, joinM] = (joinDateStr || '2025-01').split('-').map(Number);
      const productionBeforeJoin = productionDate.getFullYear() < joinY ||
        (productionDate.getFullYear() === joinY && productionDate.getMonth() < (joinM - 1));
      const productionTenureMonth = productionBeforeJoin ? 0 : this.calculateTenureMonth(joinDateStr, productionDate);

      let monthlyTP = 0;
      if (!productionBeforeJoin) {
        contracts.forEach(c => {
          if (c.status === '정상유지') {
            const startDate = new Date(c.startDate);
            const contractYear = startDate.getFullYear();
            const contractMonth = startDate.getMonth();
            const prodYear = productionDate.getFullYear();
            const prodMonth = productionDate.getMonth();

            if (contractYear === prodYear && contractMonth === prodMonth) {
              monthlyTP += (Number(c.tp) || 0);
            }
          }
        });
      }

      let plannerBonus = 0;
      if (!onlySelf && !productionBeforeJoin) {
        if (productionTenureMonth <= 24) {
          plannerBonus = this.getNewPlannerSupport(productionTenureMonth, monthlyTP);
        } else {
          plannerBonus = this.calculateSeniorPerformanceBonus(monthlyTP, clubKey);
        }
        // 신인 유지보너스 (13~18차월, 신인 1~11차월 모집계약 유지TP 기준) — 마찬가지로 전월 기준 익월 지급
        plannerBonus += this.calculateRetentionBonus(contracts, joinDateStr, productionDate);
        // 신인성과보너스 개별계약 환수 (해당월 해지/실효 계약분)
        plannerBonus -= this.calculateNewPlannerBonusClawback(contracts, joinDateStr, targetDate);
      }
      // GFC 교육비: 익월지급 지원금과 달리 등록월(위촉 1차월) 그 자체에 1회성으로 80만원 지급
      // (calculateTenureMonth는 등록월 이전도 클램프로 "1"을 반환하므로, 반드시 연/월을 직접 비교해야 함)
      if (!onlySelf && targetDate.getFullYear() === joinY && targetDate.getMonth() === (joinM - 1)) {
        plannerBonus += 800000;
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

      const schedule = this.calculateMonthlySchedule(contract, horizonMonths, joinDateStr, rangeStart);
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

  // 신인(위촉 24개월 이하)은 자기계약으로 TP를 채워야 하는 구조적 이유가 있어 완화된 기준을,
  // 시니어(25개월 이상)는 이미 안정적인 수입원이 있으므로 더 보수적인 기준을 적용한다.
  // (기존 신인/시니어 수수료 구조 분기와 동일한 24개월 경계를 그대로 재사용)
  static getSafetyThresholds(joinDateStr) {
    const tenureMonths = this.calculateTenureMonth(joinDateStr);
    const isSenior = tenureMonths > 24;
    return isSenior
      ? { safeThreshold: 0.10, cautionThreshold: 0.20, isSenior: true, tenureMonths }
      : { safeThreshold: 0.15, cautionThreshold: 0.30, isSenior: false, tenureMonths };
  }

  // 안전선 판단용 수입·지출 스냅샷. 과거만 보면 이제 막 시작한 신인은 데이터가 거의 없어 편차가 크고,
  // 반대로 미래만 보면 아직 불확실한 예상치에 낙관적으로 기울 수 있다. 그래서 "최근 최대 6개월(위촉
  // 경과월만큼) + 향후 6개월(이번 달 포함)"을 함께 평균 내어 최대 12개월 롤링 윈도우로 균형을 맞춘다.
  // (renderSelfContractSafety, updateSelfVerdictPanel 공용)
  static calculateTrailingSafetySnapshot(contracts, joinDateStr, clubKey) {
    const thresholds = this.getSafetyThresholds(joinDateStr);
    const tenureMonths = thresholds.tenureMonths; // 위촉 후 경과 차월 (최소 1, 이번 달 포함)

    const FUTURE_WINDOW = 6; // 이번 달 포함 향후 6개월
    const pastMonths = Math.max(0, Math.min(6, tenureMonths - 1)); // 이번 달을 제외한 과거 개월 수
    const totalMonths = pastMonths + FUTURE_WINDOW;

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const windowStart = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() - pastMonths, 1);

    const aggregated = this.calculateAggregatedCashflow(contracts, totalMonths, joinDateStr, clubKey, false, windowStart);
    const avgIncome = aggregated.reduce((s, d) => s + Math.max(0, d.totalIncome), 0) / totalMonths;
    const avgExpense = aggregated.reduce((s, d) => s + Math.max(0, d.selfExpense), 0) / totalMonths;
    const ratio = avgIncome > 0 ? (avgExpense / avgIncome) : (avgExpense > 0 ? 1 : 0);

    return {
      pastMonths, futureMonths: FUTURE_WINDOW, totalMonths,
      avgIncome, avgExpense, ratio,
      ...thresholds
    };
  }
}

// --- UI Controller ---
class AppUI {
  constructor() {
    this.contracts = [];
    this.recentlyDeleted = []; // 최근 소프트 삭제한 계약 (DB에서 최대 3건 조회, 다시 불러오기용)
    this.chart = null;
    this.currentFilter = 'all';
    this.searchTerm = '';
    this.currentChartTab = 'all';
    this.settings = { joinDate: '2025-01', clubTier: 'club_350' };

    this.initElements();
    this.bindEvents();
    this.loadDataAndRender();
  }

  initElements() {
    this.loginOverlay = document.getElementById('login-overlay');
    this.mainHeader = document.getElementById('main-header');
    this.loginEmail = document.getElementById('login-email');
    this.loginPassword = document.getElementById('login-password');
    this.signupInviteCode = document.getElementById('signup-invite-code');
    this.btnLogin = document.getElementById('btn-login');
    this.btnToggleSignup = document.getElementById('btn-toggle-signup');
    this.isSignupMode = false;

    this.kpiTotalCount = document.getElementById('kpi-total-count');
    this.kpiContractBreakdown = document.getElementById('kpi-contract-breakdown');
    this.kpiRealIncome = document.getElementById('kpi-real-income');
    this.kpiSelfExpense = document.getElementById('kpi-self-expense');
    this.kpiNetProfit = document.getElementById('kpi-net-profit');
    this.kpiMiniIncome = document.getElementById('kpi-mini-income');
    this.kpiMiniExpense = document.getElementById('kpi-mini-expense');
    this.kpiMiniNet = document.getElementById('kpi-mini-net');

    this.tbody = document.getElementById('contract-list-tbody');
    this.emptyState = document.getElementById('empty-state');
    this.safetyRatioValue = document.getElementById('safety-ratio-value');
    this.safetyRatioLabel = document.getElementById('safety-ratio-label');
    this.safetyRatioBadge = document.getElementById('safety-ratio-badge');
    this.safetyRatioBar = document.getElementById('safety-ratio-bar');
    this.safetyNewPremiumInput = document.getElementById('safety-new-premium');
    this.safetyRecommendation = document.getElementById('safety-recommendation');
    this.safetyChartRangeSelect = document.getElementById('safety-chart-range');
    this.safetyChart = null;
    this.btnToggleDeletedList = document.getElementById('btn-toggle-deleted-list');
    this.deletedListToggleLabel = document.getElementById('deleted-list-toggle-label');
    this.deletedListChevron = document.getElementById('deleted-list-chevron');
    this.deletedContractsPanel = document.getElementById('deleted-contracts-panel');
    this.deletedContractsList = document.getElementById('deleted-contracts-list');
    this.searchInput = document.getElementById('search-input');
    this.chartRangeSelect = document.getElementById('chart-range');
    this.selfAnalysisContainer = document.getElementById('self-contract-analysis');
    this.plannerJoinInput = document.getElementById('planner-join-date');
    this.plannerTenureBadge = document.getElementById('planner-tenure-badge');
    this.selectClubTier = document.getElementById('select-club-tier');
    this.clubTierEstimate = document.getElementById('club-tier-estimate');
    this.btnApplyClubEstimate = document.getElementById('btn-apply-club-estimate');

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
    this.selfVerdictPanel = document.getElementById('self-verdict-panel');

    this.rulesModal = document.getElementById('rules-modal');
    this.btnOpenRulesModal = document.getElementById('btn-open-rules-modal');
    this.btnCloseRulesModal = document.getElementById('btn-close-rules-modal');

    this.detailModal = document.getElementById('detail-modal');
    this.btnCloseDetailModal = document.getElementById('btn-close-detail-modal');
    this.detailModalTitle = document.getElementById('detail-modal-title');
    this.detailModalBody = document.getElementById('detail-modal-body');
  }

  bindEvents() {
    document.getElementById('btn-logout').addEventListener('click', async () => {
      await ContractStore.logout();
      location.reload();
    });

    this.btnLogin.addEventListener('click', () => this.handleLoginOrSignup());
    [this.loginEmail, this.loginPassword].forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.handleLoginOrSignup();
      });
    });
    this.btnToggleSignup.addEventListener('click', () => this.toggleSignupMode());

    this.btnOpenModal.addEventListener('click', () => this.openModal());
    this.btnCloseModal.addEventListener('click', () => this.closeModal());
    this.btnCancelModal.addEventListener('click', () => this.closeModal());
    this.btnAddPromo.addEventListener('click', () => this.addPromoGroup());

    this.btnToggleDeletedList.addEventListener('click', () => this.toggleDeletedContractsPanel());

    this.btnOpenRulesModal.addEventListener('click', () => this.rulesModal.classList.remove('hidden'));
    this.btnCloseRulesModal.addEventListener('click', () => this.rulesModal.classList.add('hidden'));

    this.btnCloseDetailModal.addEventListener('click', () => this.closeDetailModal());

    // 상세창이 열려 있을 때 모바일 뒤로가기(제스처/버튼)를 누르면 앱을 벗어나지 않고 상세창만 닫히도록 처리
    window.addEventListener('popstate', () => {
      if (!this.detailModal.classList.contains('hidden')) {
        this.closeDetailModal(true);
      }
    });

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
    this.contractForm.addEventListener('input', () => this.updateSelfVerdictPanel());
    this.contractForm.addEventListener('change', () => this.updateSelfVerdictPanel());

    this.formStatus.addEventListener('change', (e) => {
      if (e.target.value === '해지' || e.target.value === '실효') {
        this.terminationWrapper.classList.remove('hidden');
      } else {
        this.terminationWrapper.classList.add('hidden');
      }
    });

    this.plannerJoinInput.addEventListener('input', async (e) => {
      this.settings.joinDate = e.target.value;
      this.renderAll();
      try { await ContractStore.saveSettings(this.settings); } catch (err) { console.error(err); }
    });

    this.selectClubTier.addEventListener('change', async (e) => {
      this.settings.clubTier = e.target.value;
      this.renderAll();
      try { await ContractStore.saveSettings(this.settings); } catch (err) { console.error(err); }
    });

    this.btnApplyClubEstimate.addEventListener('click', async () => {
      const estimate = GfcAdvancedEngine.estimateClubTier(this.contracts, new Date());
      this.selectClubTier.value = estimate.tierKey;
      this.settings.clubTier = estimate.tierKey;
      this.renderAll();
      try { await ContractStore.saveSettings(this.settings); } catch (err) { console.error(err); }
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
    this.safetyChartRangeSelect.addEventListener('change', () => this.renderSelfContractSafety());
  }

  async loadDataAndRender() {
    let user = null;
    try {
      user = await ContractStore.checkAuth();
    } catch (e) {
      console.error('Auth check failed:', e);
    }

    if (!user) {
      this.showLoginOverlay();
      return;
    }

    await this.enterApp(user);
  }

  showLoginOverlay() {
    this.loginOverlay.classList.remove('hidden');
    this.mainHeader.classList.add('hidden');
  }

  async enterApp(user) {
    this.loginOverlay.classList.add('hidden');
    this.mainHeader.classList.remove('hidden');
    document.getElementById('user-email').textContent = user.email;

    try {
      this.settings = await ContractStore.getSettings();
      this.contracts = await ContractStore.getContractsFromSupabase();
      this.recentlyDeleted = await ContractStore.getRecentlyDeletedFromSupabase(10);
    } catch (e) {
      console.error('데이터 로드 실패:', e);
    }

    if (this.settings.joinDate) this.plannerJoinInput.value = this.settings.joinDate;
    if (this.settings.clubTier) this.selectClubTier.value = this.settings.clubTier;

    this.renderAll();
  }

  toggleSignupMode() {
    this.isSignupMode = !this.isSignupMode;
    if (this.isSignupMode) {
      this.btnLogin.textContent = '가입하기';
      this.btnToggleSignup.textContent = '로그인 화면으로 돌아가기';
      this.signupInviteCode.classList.remove('hidden');
    } else {
      this.btnLogin.textContent = '로그인';
      this.btnToggleSignup.textContent = '가입하기';
      this.signupInviteCode.classList.add('hidden');
    }
  }

  async handleLoginOrSignup() {
    let email = this.loginEmail.value.trim();
    const password = this.loginPassword.value;

    // '@' 없이 아이디만 입력한 경우: 1순위 Supabase(user_lookup 테이블)에서 등록된 이메일 조회,
    // 실패 시 config.js의 AUTO_LOGIN_EMAIL_DOMAIN으로 폴백
    if (email && !email.includes('@') && !this.isSignupMode) {
      const found = await ContractStore.lookupEmailByUsername(email);
      if (found) {
        email = found;
      } else if (typeof AUTO_LOGIN_EMAIL_DOMAIN === 'string' && AUTO_LOGIN_EMAIL_DOMAIN) {
        email = `${email}@${AUTO_LOGIN_EMAIL_DOMAIN}`;
      }
    }

    this.btnLogin.disabled = true;
    try {
      if (this.isSignupMode) {
        await ContractStore.signup(email, password);
        alert('가입이 완료되었습니다. 이메일 인증이 필요할 수 있습니다. 인증 후 로그인해주세요.');
        this.toggleSignupMode();
      } else {
        const { user } = await ContractStore.login(email, password);
        await ContractStore.registerUsernameLookup(user);
        await this.enterApp(user);
      }
    } catch (e) {
      console.error('Login/signup error:', e);
      alert((this.isSignupMode ? '가입 실패: ' : '로그인 실패: ') + e.message);
    } finally {
      this.btnLogin.disabled = false;
    }
  }

  renderAll() {
    const tenure = GfcAdvancedEngine.calculateTenureMonth(this.settings.joinDate);
    this.plannerTenureBadge.textContent = `${tenure}차월`;

    this.renderClubTierEstimate();
    this.renderKPIs();
    this.renderSelfContractSafety();
    this.renderContractTable();
    this.renderSelfAnalysis();
    this.renderChart();
    this.renderRecentlyDeleted();
    lucide.createIcons();
  }

  // 최근 3개월 평균 TP 기준으로 Club 등급을 자동 추정해서 표시. 현재 설정값과 다르면 반영 버튼 노출.
  renderClubTierEstimate() {
    const estimate = GfcAdvancedEngine.estimateClubTier(this.contracts, new Date());
    this.clubTierEstimate.textContent = `(최근 3개월 평균 TP ${estimate.avgTP.toLocaleString()}원 → 추정: ${estimate.tierName})`;
    if (estimate.tierKey !== (this.settings.clubTier || 'club_350')) {
      this.btnApplyClubEstimate.classList.remove('hidden');
    } else {
      this.btnApplyClubEstimate.classList.add('hidden');
    }
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
      if (this.kpiMiniIncome) this.kpiMiniIncome.textContent = '0 원';
      if (this.kpiMiniExpense) this.kpiMiniExpense.textContent = '0 원';
      if (this.kpiMiniNet) {
        this.kpiMiniNet.textContent = '0 원';
        this.kpiMiniNet.className = 'text-lg font-extrabold text-slate-900';
      }
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

    if (this.kpiMiniIncome) this.kpiMiniIncome.textContent = `${currentMonth.totalIncome.toLocaleString()} 원`;
    if (this.kpiMiniExpense) this.kpiMiniExpense.textContent = `${currentMonth.selfExpense.toLocaleString()} 원`;
    if (this.kpiMiniNet) {
      this.kpiMiniNet.textContent = netFormatted;
      this.kpiMiniNet.className = `text-lg font-extrabold ${currentMonth.netProfit >= 0 ? 'text-slate-900' : 'text-rose-600'}`;
    }
  }

  // 신인/시니어 구간에 따라 다른 기준선을 적용하고, 과거 실적+향후 예정 스케줄을 함께 평균 낸
  // 롤링 윈도우 비율을 "안전선" 카드에 표시한다 (자세한 로직은 calculateTrailingSafetySnapshot 참고).
  renderSelfContractSafety() {
    if (!this.safetyRatioValue) return;

    if (!this.settings.joinDate) {
      this.safetyRatioValue.textContent = '0%';
      this.safetyRatioBadge.textContent = '';
      this.safetyRatioBar.style.width = '0%';
      return;
    }

    const clubKey = this.selectClubTier.value || 'club_350';
    const snap = GfcAdvancedEngine.calculateTrailingSafetySnapshot(this.contracts, this.settings.joinDate, clubKey);
    const { pastMonths, futureMonths, totalMonths, avgIncome, avgExpense, ratio, safeThreshold, cautionThreshold, isSenior } = snap;
    const ratioPct = Math.round(ratio * 1000) / 10; // 소수 첫째자리까지
    const safePct = Math.round(safeThreshold * 100);
    const cautionPct = Math.round(cautionThreshold * 100);

    if (this.safetyRatioLabel) {
      this.safetyRatioLabel.textContent = `자기계약 안전선 (${isSenior ? '경력' : '신인'} 기준 · 최근 ${pastMonths}개월+향후 ${futureMonths}개월 평균)`;
    }
    this.safetyRatioValue.textContent = `${ratioPct}%`;

    let badgeLabel, badgeClass, barColor;
    if (ratio <= safeThreshold) {
      badgeLabel = '안전'; badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200'; barColor = 'bg-emerald-500';
    } else if (ratio <= cautionThreshold) {
      badgeLabel = '주의'; badgeClass = 'bg-amber-50 text-amber-700 border-amber-200'; barColor = 'bg-amber-500';
    } else {
      badgeLabel = '위험'; badgeClass = 'bg-rose-50 text-rose-700 border-rose-200'; barColor = 'bg-rose-500';
    }
    this.safetyRatioBadge.textContent = badgeLabel;
    this.safetyRatioBadge.className = `ml-2 inline-block text-[11px] px-2 py-0.5 rounded-full border align-middle ${badgeClass}`;
    this.safetyRatioBar.style.width = `${Math.min(100, ratioPct)}%`;
    this.safetyRatioBar.className = `h-full rounded-full transition-all duration-300 ${barColor}`;

    const thresholdNote = document.getElementById('safety-threshold-note');
    if (thresholdNote) {
      thresholdNote.textContent = `현재 적용 기준(${isSenior ? '경력 24개월 초과' : '신인 24개월 이하'}): ${safePct}% 이하 안전 · ${safePct}~${cautionPct}% 주의 · ${cautionPct}% 초과 위험 (참고용 기준선이며 개인 상황에 따라 조정하세요)`;
    }

    // 신규 자기계약 추가 시뮬레이션: 위험선까지 남은 (평균 기준) 여유 보험료 ÷ 입력한 예상 월납 = 추가 가능 건수
    if (!this.safetyRecommendation) return;
    const newPremium = parseMoneyInput(this.safetyNewPremiumInput.value);
    const headroom = Math.max(0, cautionThreshold * avgIncome - avgExpense);

    if (avgIncome <= 0) {
      this.safetyRecommendation.textContent = '진성계약 수당 데이터가 없어 계산할 수 없습니다. 진성계약을 먼저 등록해 주세요.';
    } else if (newPremium <= 0) {
      this.safetyRecommendation.textContent = `최근 ${pastMonths}개월+향후 ${futureMonths}개월 평균 기준, 위험선(${cautionPct}%)까지 여유 보험료는 월 ${Math.round(headroom).toLocaleString()}원입니다. 예상 월 보험료를 입력하면 추가 가능 건수를 계산해 드립니다.`;
    } else {
      const canAdd = Math.floor(headroom / newPremium);
      this.safetyRecommendation.innerHTML = canAdd > 0
        ? `월 ${newPremium.toLocaleString()}원짜리 자기계약을 <strong class="text-slate-800">최대 ${canAdd}건</strong>까지 추가해도 위험선(${cautionPct}%) 이내로 유지됩니다.`
        : `이미 위험선(${cautionPct}%)에 근접했거나 초과한 상태입니다. 이 금액대의 자기계약을 추가하면 비율을 넘어섭니다.`;
    }

    this.renderSelfContractSafetyChart(clubKey, safeThreshold, cautionThreshold);
  }

  // 당월 비율은 스냅샷일 뿐, 자기계약이 겹치거나 해지 타이밍이 몰리면 몇 달 뒤 비율이 급등할 수 있다.
  // 향후 12~24개월 구간의 월별 비율 추이를 선그래프로 보여줘 이런 변화를 미리 확인할 수 있게 한다.
  renderSelfContractSafetyChart(clubKey, safeThreshold, cautionThreshold) {
    const canvasEl = document.getElementById('safetyRatioChart');
    if (!canvasEl || !this.settings.joinDate) return;

    const horizon = Number(this.safetyChartRangeSelect.value) || 24;
    const aggregated = GfcAdvancedEngine.calculateAggregatedCashflow(this.contracts, horizon, this.settings.joinDate, clubKey, false);

    const labels = aggregated.map(d => d.monthLabel);
    const ratios = aggregated.map(d => {
      const income = Math.max(0, d.totalIncome);
      const expense = Math.max(0, d.selfExpense);
      const r = income > 0 ? (expense / income) : (expense > 0 ? 1 : 0);
      return Math.round(r * 1000) / 10;
    });
    const safeLine = labels.map(() => safeThreshold * 100);
    const cautionLine = labels.map(() => cautionThreshold * 100);

    const ctx = canvasEl.getContext('2d');
    if (this.safetyChart) this.safetyChart.destroy();

    this.safetyChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: '자기계약 지출 비율 (%)',
            data: ratios,
            borderColor: '#4f46e5',
            backgroundColor: 'rgba(79,70,229,0.08)',
            borderWidth: 2,
            pointRadius: 2,
            fill: true,
            tension: 0.3
          },
          {
            label: `주의선 (${Math.round(safeThreshold * 100)}%)`,
            data: safeLine,
            borderColor: '#f59e0b',
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 0,
            fill: false
          },
          {
            label: `위험선 (${Math.round(cautionThreshold * 100)}%)`,
            data: cautionLine,
            borderColor: '#e11d48',
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 10, font: { size: 10, family: 'Noto Sans KR' } }
          },
          tooltip: {
            callbacks: {
              label: (item) => `${item.dataset.label}: ${item.formattedValue}%`
            }
          }
        },
        scales: {
          x: { ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true } },
          y: {
            beginAtZero: true,
            ticks: { font: { size: 9 }, callback: (v) => `${v}%` }
          }
        }
      }
    });
  }

  renderContractTable() {
    let filtered = this.contracts.filter(c => {
      const matchFilter = this.currentFilter === 'all' || c.contractType === this.currentFilter;
      const matchSearch = !this.searchTerm || 
        (c.client || '').toLowerCase().includes(this.searchTerm) || 
        (c.company || '').toLowerCase().includes(this.searchTerm) ||
        (c.title || '').toLowerCase().includes(this.searchTerm) ||
        (c.productGroup || '').toLowerCase().includes(this.searchTerm);
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

      const promoGroupCount = GfcAdvancedEngine.normalizePromotions(c.promotions).length;
      const totalPromoCalc = GfcAdvancedEngine.flattenPromotionPayouts(c.promotions).reduce((sum, p) => {
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
            <div class="text-[10px] font-normal text-slate-400">${promoGroupCount}개 프로모션</div>
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
      const isSenior = GfcAdvancedEngine.calculateTenureMonth(this.settings.joinDate, new Date(c.startDate)) > 24;
      const premium = Number(c.premium) || 0;
      const surrender16 = Number(c.surrenderValue16) || 0;

      const feeRates = GfcAdvancedEngine.getFeeSchedule(c.productGroup, isSenior);
      const totalComm = GfcAdvancedEngine.calculateTotalCommissionThrough15Rounds(c, feeRates);

      const totalPromoCalc = GfcAdvancedEngine.flattenPromotionPayouts(c.promotions).reduce((sum, p) => {
        const val = Number(p.value) || 0;
        return sum + (p.type === 'percent' ? premium * (val / 100) : val);
      }, 0);

      const tpBonusDiff = GfcAdvancedEngine.calculateAttributedTPBonus(c, this.contracts, this.settings.joinDate, this.selectClubTier.value || 'club_350');

      const totalIncomeNet = (totalComm + totalPromoCalc) * (1 - 0.008);
      const totalExpense15 = premium * 15;
      const healthBonusClawback = GfcAdvancedEngine.calculateHealthBonusClawback(c, 15);
      const generalPromoClawback = GfcAdvancedEngine.calculateGeneralPromoClawback(c, 15);
      const netProfitAt16 = totalIncomeNet + surrender16 - totalExpense15 + tpBonusDiff - healthBonusClawback - generalPromoClawback;

      return `
        <div onclick="app.openSelfContractDetail('${c.id}')" class="p-5 bg-slate-50 rounded-xl border border-slate-200 text-sm cursor-pointer hover:border-emerald-500 hover:shadow-md transition group flex items-center justify-between gap-3" title="클릭하여 상세 수지분석 보기">
          <span class="font-bold text-slate-800 flex items-center gap-1.5 truncate text-base">
            <i data-lucide="external-link" class="w-4 h-4 text-emerald-600 shrink-0 group-hover:scale-110 transition"></i>
            <span class="truncate">${c.title}</span>
          </span>
          <span class="shrink-0 font-extrabold text-lg ${netProfitAt16 >= 0 ? 'text-emerald-600' : 'text-rose-600'}">
            ${netProfitAt16 >= 0 ? '+' : ''}${Math.round(netProfitAt16).toLocaleString()}원
          </span>
        </div>
      `;
    }).join('');

    lucide.createIcons();
  }

  renderChart() {
    const horizon = Number(this.chartRangeSelect.value) || 24;
    const clubKey = this.selectClubTier.value || 'club_350';
    const onlySelf = (this.currentChartTab === 'self');

    // 첫 계약(또는 등록일) 시작월부터 과거 데이터도 함께 보여줌
    const now = new Date();
    const todayMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const baseDate = GfcAdvancedEngine.getEarliestRelevantMonth(this.contracts, this.settings.joinDate);
    const pastMonths = Math.max(0, GfcAdvancedEngine.monthDiff(todayMonth, baseDate));
    const totalHorizon = pastMonths + horizon;

    const aggregated = GfcAdvancedEngine.calculateAggregatedCashflow(this.contracts, totalHorizon, this.settings.joinDate, clubKey, onlySelf, baseDate);

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
        label: '진성 + 성과보너스 + 프로모션 수입 (공제후)',
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

  // 상세창을 열면서, 뒤로가기(모바일 제스처/버튼)로 상세창만 닫을 수 있도록 history state를 하나 쌓는다.
  showDetailModal() {
    this.detailModal.classList.remove('hidden');
    history.pushState({ appModal: 'detail' }, '');
  }

  // fromPopState가 true면 popstate 이벤트로 인해 이미 뒤로 이동한 상태이므로 history.back()을 다시 호출하지 않는다.
  // (X 버튼 클릭 등 사용자가 직접 닫은 경우에는 쌓아둔 history state를 정리하기 위해 history.back()을 호출)
  closeDetailModal(fromPopState = false) {
    this.detailModal.classList.add('hidden');
    if (!fromPopState && history.state && history.state.appModal === 'detail') {
      history.back();
    }
  }

  openDetailModal(type) {
    const clubKey = this.selectClubTier.value || 'club_350';
    const horizon = Number(this.chartRangeSelect ? this.chartRangeSelect.value : 24) || 24;

    // 첫 계약(또는 등록일) 시작월부터 과거 데이터도 함께 조회 가능하도록 범위 확장
    const now = new Date();
    const todayMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const baseDate = GfcAdvancedEngine.getEarliestRelevantMonth(this.contracts, this.settings.joinDate);
    const pastMonths = Math.max(0, GfcAdvancedEngine.monthDiff(todayMonth, baseDate));
    const totalHorizon = pastMonths + horizon;

    const aggregated = GfcAdvancedEngine.calculateAggregatedCashflow(this.contracts, totalHorizon, this.settings.joinDate, clubKey, false, baseDate);

    const titleMap = {
      income: '당월 총수입 (수수료+프로모션+보너스) 상세 내역',
      expense: '당월 자기계약 보험료 지출 상세 내역',
      net: '당월 최종 순손익 산출 내역'
    };
    let title = titleMap[type] || '월별 상세 수입 및 지출 예측 내역';

    const renderMonthDetail = (mIdx) => {
      const item = aggregated[mIdx] || aggregated[0];
      const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + mIdx, 1);
      // 신인/시니어 지원금은 "이번 달 실적"이 아니라 "지난 달 실적"을 기준으로 이번 달에 지급된다
      // (익월 지급 원칙 — calculateAggregatedCashflow와 반드시 동일한 기준을 써야 지원금 합계가 일치함)
      const productionDate = new Date(targetDate.getFullYear(), targetDate.getMonth() - 1, 1);
      const [joinY, joinM] = (this.settings.joinDate || '2025-01').split('-').map(Number);
      const productionBeforeJoin = productionDate.getFullYear() < joinY ||
        (productionDate.getFullYear() === joinY && productionDate.getMonth() < (joinM - 1));
      const tMonth = productionBeforeJoin ? 0 : GfcAdvancedEngine.calculateTenureMonth(this.settings.joinDate, productionDate);
      const isSen = tMonth > 24;

      // 지난 달(전월) "신규" TP (그 달에 시작된 계약만) — KPI 집계 엔진(calculateAggregatedCashflow)과
      // 동일한 기준이어야 지원금 합계가 일치함. 정착수수료/성과보너스는 전월 신규 TP 기준으로 산정됨.
      let newContractTP = 0;
      if (!productionBeforeJoin) {
        this.contracts.forEach(c => {
          if (c.status !== '정상유지') return;
          const startDate = new Date(c.startDate);
          if (startDate.getFullYear() === productionDate.getFullYear() && startDate.getMonth() === productionDate.getMonth()) {
            newContractTP += (Number(c.tp) || 0);
          }
        });
      }

      // 당월 수수료·프로모션이 발생하는 계약들의 TP 합계 (1~60회차 진행 중인 전체 계약, 표시용)
      // 수수료는 납입 다음 달에 지급되므로, "이번 달에 지급되는 수수료"는 전월(elapsed-1) 납입분 기준이다.
      let totalTP = 0;
      let contractRows = this.contracts.map(c => {
        if (c.status !== '정상유지') return '';
        const startDate = new Date(c.startDate);
        const elapsed = (targetDate.getFullYear() - startDate.getFullYear()) * 12 + (targetDate.getMonth() - startDate.getMonth());
        const incomeRoundIndex = elapsed - 1;
        if (incomeRoundIndex < 0 || incomeRoundIndex >= 60) return '';

        const tp = Number(c.tp) || 0;

        const feeRates = GfcAdvancedEngine.getFeeSchedule(c.productGroup, isSen);
        const rate = GfcAdvancedEngine.getCombinedCommissionRate(c.productGroup, incomeRoundIndex, feeRates);
        if (rate <= 0 && !(c.productGroup === '건강/상해보험' && incomeRoundIndex === 12)) return '';

        totalTP += tp;

        // 실제 KPI/차트 집계와 완전히 동일한 엔진 함수를 그대로 재사용 (수수료/프로모션 시점 계산 이중 구현 방지)
        const contractSchedule = GfcAdvancedEngine.calculateMonthlySchedule(c, mIdx + 1, this.settings.joinDate, baseDate);
        const monthData = contractSchedule[mIdx] || { commissionIncome: 0, promoIncome: 0 };
        const comm = monthData.commissionIncome;
        const promo = monthData.promoIncome;

        // 이 달에 지급되는 개별 프로모션 내역(이름/금액)을 상세히 표기
        const promoDetailRows = GfcAdvancedEngine.flattenPromotionPayouts(c.promotions)
          .filter(p => Number(p.afterPaymentMonth) === (incomeRoundIndex + 1))
          .map(p => {
            const val = Number(p.value) || 0;
            const earned = p.type === 'percent' ? Number(c.premium) * (val / 100) : val;
            return `<div class="flex justify-between text-[11px] text-emerald-700 pl-3"><span>· ${p.groupName} (${p.type === 'percent' ? val + '%' : val.toLocaleString() + '원 고정'})</span><span>+${Math.round(earned).toLocaleString()}원</span></div>`;
          }).join('');

        const badgeColor = c.contractType === '자기계약' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700';

        return `
          <div class="p-4 bg-white rounded-xl border border-slate-200 text-xs space-y-2">
            <div class="flex justify-between items-start">
              <div class="space-y-0.5">
                <div class="flex items-center gap-1.5">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${badgeColor}">${c.contractType}</span>
                  <span class="font-bold text-slate-800 text-sm">${c.title}</span>
                </div>
                <div class="text-[11px] text-slate-500">${c.client} · ${c.company} · ${c.productGroup}</div>
              </div>
              <span class="text-emerald-600 font-bold text-sm">+${Math.round(comm + promo).toLocaleString()}원</span>
            </div>
            <div class="border-t border-slate-100 pt-1.5 space-y-1">
              <div class="text-[11px] text-slate-500 flex justify-between">
                <span>${incomeRoundIndex + 1}회차 납입분 수수료 지급 (수수료율 ${rate}% · 월납보험료 ${Number(c.premium).toLocaleString()}원 · TP ${tp.toLocaleString()}원)</span>
                <span class="font-semibold text-slate-700">수수료 +${Math.round(comm).toLocaleString()}원</span>
              </div>
              ${promo > 0 ? `
              <div class="flex justify-between text-[11px] text-emerald-700 font-semibold">
                <span>이번 달 지급 프로모션 합계</span>
                <span>+${Math.round(promo).toLocaleString()}원</span>
              </div>
              ${promoDetailRows}` : ''}
            </div>
          </div>
        `;
      }).filter(Boolean).join('');

      let bonusBreakdown = '';
      const retentionBonus = GfcAdvancedEngine.calculateRetentionBonus(this.contracts, this.settings.joinDate, productionDate);
      const bonusClawback = GfcAdvancedEngine.calculateNewPlannerBonusClawback(this.contracts, this.settings.joinDate, targetDate);
      const eduBonus = (targetDate.getFullYear() === joinY && targetDate.getMonth() === (joinM - 1)) ? 800000 : 0;
      const extraRows = `
            ${retentionBonus > 0 ? `<div class="flex justify-between"><span>신인 유지보너스 (13~18차월 유지TP 기준):</span> <strong>+${retentionBonus.toLocaleString()}원</strong></div>` : ''}
            ${eduBonus > 0 ? `<div class="flex justify-between"><span>GFC 교육비 (등록월 1회성):</span> <strong>+${eduBonus.toLocaleString()}원</strong></div>` : ''}
            ${bonusClawback > 0 ? `<div class="flex justify-between text-rose-600"><span>신인성과보너스 환수 (당월 해지/실효 계약분):</span> <strong>-${bonusClawback.toLocaleString()}원</strong></div>` : ''}`;

      if (!isSen) {
        // 실제 KPI 집계와 완전히 동일한 엔진 함수를 그대로 재사용 (지원금 계산 이중 구현 방지)
        const baseSettlement = tMonth <= 11
          ? (newContractTP >= 700000 ? 2300000 : newContractTP >= 500000 ? 2100000 : newContractTP >= 300000 ? 1500000 : (newContractTP > 0 ? 500000 : 0))
          : 0;
        const totalSupport = GfcAdvancedEngine.getNewPlannerSupport(tMonth, newContractTP);
        const perfBonus = totalSupport - baseSettlement;
        const bonusTotal = baseSettlement + perfBonus + retentionBonus + eduBonus - bonusClawback;

        bonusBreakdown = `
          <div class="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 space-y-1.5">
            <p class="font-bold text-sm">✨ 신인 GFC 지원금 세부 구성 (${tMonth}차월 | 당월 신규 TP: ${newContractTP.toLocaleString()}원)</p>
            <div class="flex justify-between"><span>기본 정착수수료 ${tMonth > 11 ? '(1~11차월만 지급)' : ''}:</span> <strong>+${baseSettlement.toLocaleString()}원</strong></div>
            <div class="flex justify-between"><span>성과보너스 (업적 연동):</span> <strong>+${Math.round(perfBonus).toLocaleString()}원</strong></div>${extraRows}
            <div class="border-t border-emerald-200 pt-1.5 flex justify-between font-bold text-emerald-800 text-sm"><span>지원금 합계:</span> <strong>+${Math.round(bonusTotal).toLocaleString()}원</strong></div>
          </div>
        `;
      } else {
        // 실제 KPI 집계와 완전히 동일한 엔진 함수를 그대로 재사용 (지원금 계산 이중 구현 방지)
        const achBonus = newContractTP >= 300000 ? newContractTP * 2.0 : newContractTP * 0.7;
        const clubParams = GfcAdvancedEngine.getClubBonusParams(clubKey);
        const totalSeniorBonus = GfcAdvancedEngine.calculateSeniorPerformanceBonus(newContractTP, clubKey);
        const clubBonus = Math.min(5000000, newContractTP * clubParams.rate);
        const myungInBonus = totalSeniorBonus - Math.round(achBonus) - Math.round(clubBonus);
        const bonusTotal = Math.round(achBonus) + Math.round(clubBonus) + Math.max(0, myungInBonus) + retentionBonus + eduBonus - bonusClawback;

        bonusBreakdown = `
          <div class="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 space-y-1.5">
            <p class="font-bold text-sm">✨ 시니어 성과보너스 세부 구성 (${clubParams.name} | 당월 신규 TP: ${newContractTP.toLocaleString()}원)</p>
            <div class="flex justify-between"><span>업적분 (${newContractTP >= 300000 ? '200%' : '70%'}):</span> <strong>+${Math.round(achBonus).toLocaleString()}원</strong></div>
            <div class="flex justify-between"><span>클럽분 (${clubParams.name} ${clubParams.rate * 100}%):</span> <strong>+${Math.round(clubBonus).toLocaleString()}원</strong></div>
            ${myungInBonus > 0 ? `<div class="flex justify-between"><span>초과 명인보너스:</span> <strong>+${Math.round(myungInBonus).toLocaleString()}원</strong></div>` : ''}${extraRows}
            <div class="border-t border-emerald-200 pt-1.5 flex justify-between font-bold text-emerald-800 text-sm"><span>보너스 합계:</span> <strong>+${bonusTotal.toLocaleString()}원</strong></div>
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

      const monthSelector = `
        <div class="flex items-center justify-between bg-slate-100 p-3 rounded-xl">
          <label class="font-bold text-slate-700 text-xs">조회 월 선택 (첫 계약월부터 향후 ${horizon}개월까지):</label>
          <select id="detail-month-selector" class="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500">
            ${aggregated.map((d, i) => `<option value="${i}" ${i === mIdx ? 'selected' : ''}>${d.monthLabel}${i === pastMonths ? ' (이번달)' : ''}</option>`).join('')}
          </select>
        </div>
      `;

      // 순손익(net) 상세창 전용: 첫 등록월부터 선택월까지의 누적 수입/지출/순손익
      let cumIncome = 0, cumExpense = 0, cumNet = 0;
      for (let i = 0; i <= mIdx; i++) {
        cumIncome += aggregated[i].totalIncome;
        cumExpense += aggregated[i].selfExpense;
        cumNet += aggregated[i].netProfit;
      }

      const summaryBoxes = type === 'net' ? `
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="p-3 rounded-xl border bg-emerald-50 border-emerald-200">
            <span class="text-[10px] text-slate-500 block">누적 총수입</span>
            <strong class="text-emerald-700 text-sm">+${cumIncome.toLocaleString()}원</strong>
          </div>
          <div class="p-3 rounded-xl border bg-rose-50 border-rose-200">
            <span class="text-[10px] text-slate-500 block">누적 자기계약 보험료지출</span>
            <strong class="text-rose-600 text-sm">-${cumExpense.toLocaleString()}원</strong>
          </div>
          <div class="p-3 rounded-xl border bg-blue-100 border-blue-400 ring-2 ring-blue-400">
            <span class="text-[10px] text-slate-500 block">누적 순손익</span>
            <strong class="text-blue-700 text-lg font-extrabold">${cumNet >= 0 ? '+' : ''}${cumNet.toLocaleString()}원</strong>
          </div>
        </div>
      ` : `
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="p-3 rounded-xl border ${type === 'income' ? 'bg-emerald-100 border-emerald-400 ring-2 ring-emerald-400' : 'bg-emerald-50 border-emerald-200'}">
            <span class="text-[10px] text-slate-500 block">당월 총수입</span>
            <strong class="text-emerald-700 ${type === 'income' ? 'text-lg font-extrabold' : 'text-sm'}">+${item.totalIncome.toLocaleString()}원</strong>
          </div>
          <div class="p-3 rounded-xl border ${type === 'expense' ? 'bg-rose-100 border-rose-400 ring-2 ring-rose-400' : 'bg-rose-50 border-rose-200'}">
            <span class="text-[10px] text-slate-500 block">자기계약 보험료지출</span>
            <strong class="text-rose-600 ${type === 'expense' ? 'text-lg font-extrabold' : 'text-sm'}">-${item.selfExpense.toLocaleString()}원</strong>
          </div>
          <div class="p-3 rounded-xl border bg-blue-50 border-blue-200">
            <span class="text-[10px] text-slate-500 block">당월 순손익</span>
            <strong class="text-blue-700 text-sm">${item.netProfit >= 0 ? '+' : ''}${item.netProfit.toLocaleString()}원</strong>
          </div>
        </div>
      `;

      const incomeSection = `
        ${bonusBreakdown}
        <div>
          <h4 class="font-bold text-slate-800 mb-2 text-xs">해당 월 계약별 수수료 및 프로모션 상세 (수수료 발생 계약 TP 합계: ${totalTP.toLocaleString()}원)</h4>
          <div class="space-y-2 max-h-[420px] overflow-y-auto custom-scrollbar">
            ${contractRows || '<p class="text-slate-400 text-center py-4">해당 월에 실적이 발생하는 정상유지 계약이 없습니다.</p>'}
          </div>
        </div>
      `;

      const expenseSection = `
        <div>
          <h4 class="font-bold text-slate-800 mb-2 text-xs">해당 월 자기계약 보험료 지출 상세</h4>
          <div class="space-y-2 max-h-[420px] overflow-y-auto custom-scrollbar">
            ${selfExpenseDetails || '<p class="text-slate-400 text-center py-4">지출 중인 자기계약이 없습니다.</p>'}
          </div>
        </div>
      `;

      // 순손익(net) 상세창 전용: 첫 등록월부터 선택월까지 계약별 누적 수입/지출 상세
      let cumTotalTP = 0;
      let cumContractRows = this.contracts.map(c => {
        const schedule = GfcAdvancedEngine.calculateMonthlySchedule(c, mIdx + 1, this.settings.joinDate, baseDate);
        let sumComm = 0, sumPromo = 0, sumClawback = 0, paidRounds = 0;
        for (let i = 0; i <= mIdx; i++) {
          const d = schedule[i];
          if (!d) continue;
          sumComm += d.commissionIncome;
          sumPromo += d.promoIncome;
          sumClawback += d.clawbackAmount;
          if (d.commissionIncome > 0 || d.promoIncome > 0) paidRounds++;
        }
        if (sumComm + sumPromo <= 0 && sumClawback <= 0) return '';
        cumTotalTP += Number(c.tp) || 0;
        const badgeColor = c.contractType === '자기계약' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700';
        return `
          <div class="p-4 bg-white rounded-xl border border-slate-200 text-xs space-y-1.5">
            <div class="flex justify-between items-start">
              <div class="space-y-0.5">
                <div class="flex items-center gap-1.5">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${badgeColor}">${c.contractType}</span>
                  <span class="font-bold text-slate-800 text-sm">${c.title}</span>
                </div>
                <div class="text-[11px] text-slate-500">${c.client} · ${c.company} · ${c.productGroup} · TP ${(Number(c.tp) || 0).toLocaleString()}원</div>
              </div>
              <span class="text-emerald-600 font-bold text-sm">+${Math.round(sumComm + sumPromo - sumClawback).toLocaleString()}원</span>
            </div>
            <div class="border-t border-slate-100 pt-1.5 grid grid-cols-3 gap-1 text-[11px] text-slate-600">
              <div>수수료 누계<br><strong class="text-slate-800">+${Math.round(sumComm).toLocaleString()}원</strong></div>
              <div>프로모션 누계<br><strong class="text-slate-800">+${Math.round(sumPromo).toLocaleString()}원</strong></div>
              <div>환수 누계<br><strong class="${sumClawback > 0 ? 'text-rose-600' : 'text-slate-800'}">-${Math.round(sumClawback).toLocaleString()}원</strong></div>
            </div>
          </div>
        `;
      }).filter(Boolean).join('');

      // 누적 신인/시니어 지원금 (월별 지원금만 별도 합산 — calculateAggregatedCashflow와 동일 산식)
      let cumPlannerBonus = 0;
      for (let i = 0; i <= mIdx; i++) {
        const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1);
        const prodD = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        const prodBeforeJoin = prodD.getFullYear() < joinY || (prodD.getFullYear() === joinY && prodD.getMonth() < (joinM - 1));
        const tM = prodBeforeJoin ? 0 : GfcAdvancedEngine.calculateTenureMonth(this.settings.joinDate, prodD);
        let mTP = 0;
        if (!prodBeforeJoin) {
          this.contracts.forEach(c => {
            if (c.status !== '정상유지') return;
            const sd = new Date(c.startDate);
            if (sd.getFullYear() === prodD.getFullYear() && sd.getMonth() === prodD.getMonth()) mTP += (Number(c.tp) || 0);
          });
        }
        let pb = 0;
        if (!prodBeforeJoin) {
          pb = tM <= 24 ? GfcAdvancedEngine.getNewPlannerSupport(tM, mTP) : GfcAdvancedEngine.calculateSeniorPerformanceBonus(mTP, clubKey);
          pb += GfcAdvancedEngine.calculateRetentionBonus(this.contracts, this.settings.joinDate, prodD);
          pb -= GfcAdvancedEngine.calculateNewPlannerBonusClawback(this.contracts, this.settings.joinDate, d);
        }
        if (d.getFullYear() === joinY && d.getMonth() === (joinM - 1)) pb += 800000;
        cumPlannerBonus += pb;
      }

      let cumSelfExpenseRows = this.contracts.map(c => {
        if (c.contractType !== '자기계약') return '';
        const schedule = GfcAdvancedEngine.calculateMonthlySchedule(c, mIdx + 1, this.settings.joinDate, baseDate);
        let sumExp = 0;
        for (let i = 0; i <= mIdx; i++) sumExp += (schedule[i] ? schedule[i].premiumExpense : 0);
        if (sumExp <= 0) return '';
        return `
          <div class="p-3 bg-white rounded-xl border border-slate-200 text-xs flex justify-between items-center">
            <strong>${c.title} (${c.client})</strong>
            <strong class="text-rose-600">-${Math.round(sumExp).toLocaleString()}원</strong>
          </div>
        `;
      }).filter(Boolean).join('');

      const cumIncomeSection = `
        <div class="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900">
          <p class="font-bold text-sm">✨ 누적 신인/시니어 지원금 (등록월~선택월)</p>
          <div class="flex justify-between pt-1"><span>지원금 합계:</span> <strong>+${Math.round(cumPlannerBonus).toLocaleString()}원</strong></div>
        </div>
        <div>
          <h4 class="font-bold text-slate-800 mb-2 text-xs">계약별 누적 수수료 및 프로모션 상세 (등록월~선택월, 관련 계약 TP 합계: ${cumTotalTP.toLocaleString()}원)</h4>
          <div class="space-y-2 max-h-[420px] overflow-y-auto custom-scrollbar">
            ${cumContractRows || '<p class="text-slate-400 text-center py-4">누적 실적이 있는 계약이 없습니다.</p>'}
          </div>
        </div>
      `;

      const cumExpenseSection = `
        <div>
          <h4 class="font-bold text-slate-800 mb-2 text-xs">계약별 누적 자기계약 보험료 지출 상세 (등록월~선택월)</h4>
          <div class="space-y-2 max-h-[420px] overflow-y-auto custom-scrollbar">
            ${cumSelfExpenseRows || '<p class="text-slate-400 text-center py-4">지출 중인 자기계약이 없습니다.</p>'}
          </div>
        </div>
      `;

      let bodySections;
      if (type === 'income') {
        bodySections = incomeSection;
      } else if (type === 'expense') {
        bodySections = expenseSection;
      } else {
        // 순손익: 당월이 아니라 첫 등록월부터 선택월까지의 누적 수입/지출 상세를 보여줌
        bodySections = `${cumIncomeSection}${cumExpenseSection}`;
      }

      return `
        <div class="space-y-4">
          ${monthSelector}
          ${summaryBoxes}
          ${bodySections}
        </div>
      `;
    };

    this.detailModalTitle.textContent = title;
    this.detailModalBody.innerHTML = renderMonthDetail(pastMonths);
    this.showDetailModal();

    // detail-month-selector는 매번 innerHTML로 새로 생성되므로, 사라지지 않는
    // 부모(detailModalBody)에 위임 방식으로 리스너를 걸어야 두 번째 이후 변경도 동작함
    this.detailModalBody.onchange = (e) => {
      if (e.target && e.target.id === 'detail-month-selector') {
        const idx = Number(e.target.value);
        this.detailModalBody.innerHTML = renderMonthDetail(idx);
        lucide.createIcons();
      }
    };

    lucide.createIcons();
  }

  openSelfContractDetail(contractId) {
    const c = this.contracts.find(item => item.id === contractId);
    if (!c) return;

    const isSenior = GfcAdvancedEngine.calculateTenureMonth(this.settings.joinDate, new Date(c.startDate)) > 24;
    const premium = Number(c.premium) || 0;
    const tp = Number(c.tp) || 0;
    const surrender16 = Number(c.surrenderValue16) || 0;

    const feeRates = GfcAdvancedEngine.getFeeSchedule(c.productGroup, isSenior);
    const totalComm = GfcAdvancedEngine.calculateTotalCommissionThrough15Rounds(c, feeRates);
    
    const promotions = GfcAdvancedEngine.normalizePromotions(c.promotions);
    const totalPromoCalc = GfcAdvancedEngine.flattenPromotionPayouts(c.promotions).reduce((sum, p) => {
      const val = Number(p.value) || 0;
      return sum + (p.type === 'percent' ? premium * (val / 100) : val);
    }, 0);

    const totalGross = totalComm + totalPromoCalc;
    const deduction = Math.round(totalGross * 0.008);
    const totalIncomeNet = totalGross - deduction;
    const totalExpense15 = premium * 15;
    const tpBonusDiff = GfcAdvancedEngine.calculateAttributedTPBonus(c, this.contracts, this.settings.joinDate, this.selectClubTier.value || 'club_350');
    const healthBonusClawback = GfcAdvancedEngine.calculateHealthBonusClawback(c, 15);
    const generalPromoClawback = GfcAdvancedEngine.calculateGeneralPromoClawback(c, 15);
    const netProfitAt16 = totalIncomeNet + surrender16 - totalExpense15 + tpBonusDiff - healthBonusClawback - generalPromoClawback;

    let monthlyCommRows = feeRates.map((rate, idx) => {
      const combinedRate = GfcAdvancedEngine.getCombinedCommissionRate(c.productGroup, idx, feeRates);
      const mgmtRate = combinedRate - rate;
      let comm = tp * (combinedRate / 100);
      let extra = '';
      if (mgmtRate > 0) extra += ` (신계약 ${rate}% + 계약관리보너스 ${mgmtRate}%)`;
      return `<div class="flex justify-between py-1 border-b border-slate-100"><span>${idx + 1}회차 (환산율 ${combinedRate}%)${extra}:</span> <strong class="text-emerald-600">+${Math.round(comm).toLocaleString()}원</strong></div>`;
    }).join('');

    let promoRows = promotions.flatMap(g => g.payouts.map(p => ({ name: g.name, ...p }))).map((p) => {
      let val = Number(p.value) || 0;
      let earned = p.type === 'percent' ? premium * (val / 100) : val;
      return `<div class="flex justify-between py-1 border-b border-slate-100"><span>${p.name} (${p.afterPaymentMonth}회차 납입 후 익월):</span> <strong class="text-emerald-600">+${Math.round(earned).toLocaleString()}원</strong></div>`;
    }).join('') || '<p class="text-slate-400">적용된 프로모션이 없습니다.</p>';

    let htmlContent = `
      <div class="space-y-4">
        <div class="p-4 bg-rose-50 rounded-xl border border-rose-200 text-rose-900 space-y-2">
          <p class="font-bold text-sm">🛡️ ${c.title} (${c.client}) 16 회차 해지 수지분석 상세</p>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div>15 회 총 납입지출: <strong class="text-rose-600">-${totalExpense15.toLocaleString()}원</strong></div>
            <div>해약환급금(16 회차): <strong class="text-blue-600">+${surrender16.toLocaleString()}원</strong></div>
            <div>수수료 + 프로모션 (공제전): <strong class="text-emerald-600">+${Math.round(totalGross).toLocaleString()}원</strong></div>
            <div>고용보험공제 (0.8%): <strong class="text-rose-600">-${deduction.toLocaleString()}원</strong></div>
            <div class="col-span-2">이 계약의 TP로 늘어난 신인/시니어 지원금: <strong class="text-emerald-600">+${Math.round(tpBonusDiff).toLocaleString()}원</strong></div>
            ${healthBonusClawback > 0 ? `
            <div class="col-span-2">건강상해보너스 환수 (16회차 미유지, 환수율 70%): <strong class="text-rose-600">-${healthBonusClawback.toLocaleString()}원</strong></div>
            ` : ''}
            ${generalPromoClawback > 0 ? `
            <div class="col-span-2">기타 프로모션 환수 (13회차 이후 지급분, 25회차 이전 해지, 환수율 70%): <strong class="text-rose-600">-${generalPromoClawback.toLocaleString()}원</strong></div>
            ` : ''}
          </div>
          <div class="border-t border-rose-200 pt-2 flex justify-between items-center">
            <span class="text-sm font-bold">16 회 해지 시 최종 순손익:</span>
            <span class="text-xl font-extrabold ${netProfitAt16 >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${netProfitAt16 >= 0 ? '+' : ''}${Math.round(netProfitAt16).toLocaleString()}원</span>
          </div>
        </div>

        <div>
          <h4 class="font-bold text-slate-800 mb-2">1~15 회차 월별 수수료 지급 내역</h4>
          <div class="space-y-1 max-h-[160px] overflow-y-auto custom-scrollbar text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
            ${monthlyCommRows}
          </div>
        </div>

        <div>
          <h4 class="font-bold text-slate-800 mb-2">적용된 프로모션 상세</h4>
          <div class="space-y-1 max-h-[120px] overflow-y-auto custom-scrollbar text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
            ${promoRows}
          </div>
        </div>
      </div>
    `;

    this.detailModalTitle.textContent = `자기계약 수지분석 상세 — ${c.title}`;
    this.detailModalBody.innerHTML = htmlContent;
    this.showDetailModal();
    lucide.createIcons();
  }

  // 프로모션 카드(드롭다운 선택 또는 직접입력)에서 최종 프로모션 명칭을 읽어온다.
  getPromoGroupName(group) {
    const select = group.querySelector('.promo-name-select');
    const custom = group.querySelector('.promo-name-custom');
    if (select && select.value === '__custom__') {
      return (custom && custom.value.trim()) || '프로모션';
    }
    return (select && select.value) || '프로모션';
  }

  addPromoGroup(promo = null) {
    const div = document.createElement('div');
    div.className = 'promo-group bg-white rounded-lg border border-emerald-200 p-2.5 space-y-2';
    div.innerHTML = `
      <div class="flex items-center gap-2">
        <select class="promo-name-select px-2 py-1.5 bg-slate-50 border border-slate-300 rounded text-xs font-semibold focus:ring-2 focus:ring-emerald-500 focus:outline-none">
          <option value="건강상해보너스">건강상해보너스</option>
          <option value="상품프로모션">상품프로모션</option>
          <option value="지점지원금">지점지원금</option>
          <option value="__custom__">직접입력...</option>
        </select>
        <input type="text" class="promo-name-custom hidden flex-1 px-2 py-1.5 bg-slate-50 border border-slate-300 rounded text-xs font-semibold focus:ring-2 focus:ring-emerald-500 focus:outline-none" placeholder="프로모션 명칭 직접 입력">
        <button type="button" class="btn-remove-promo-group text-rose-500 hover:text-rose-700 p-1 ml-auto" title="이 프로모션 전체 삭제">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
      <p class="text-[10px] text-slate-400 -mt-1">건강상해보너스 외 프로모션은 13회차 이후 지급분이 25회차 이전 해지 시 70% 환수됩니다.</p>
      <div class="promo-payouts-container space-y-1.5"></div>
      <button type="button" class="btn-add-promo-payout text-[11px] text-emerald-700 hover:text-emerald-900 font-medium flex items-center gap-1">
        <i data-lucide="plus" class="w-3 h-3"></i> 회차/금액 추가
      </button>
    `;
    this.promotionsContainer.appendChild(div);

    const STANDARD_PROMO_NAMES = ['건강상해보너스', '상품프로모션', '지점지원금'];
    const nameSelect = div.querySelector('.promo-name-select');
    const nameCustom = div.querySelector('.promo-name-custom');
    const existingName = (promo && promo.name) ? promo.name.trim() : '';

    if (!existingName) {
      nameSelect.value = '상품프로모션';
      nameCustom.classList.add('hidden');
    } else if (STANDARD_PROMO_NAMES.includes(existingName)) {
      nameSelect.value = existingName;
      nameCustom.classList.add('hidden');
    } else {
      nameSelect.value = '__custom__';
      nameCustom.value = existingName;
      nameCustom.classList.remove('hidden');
    }

    nameSelect.addEventListener('change', () => {
      if (nameSelect.value === '__custom__') {
        nameCustom.classList.remove('hidden');
        nameCustom.focus();
      } else {
        nameCustom.classList.add('hidden');
      }
    });

    div.querySelector('.btn-remove-promo-group').addEventListener('click', () => div.remove());

    const payoutsContainer = div.querySelector('.promo-payouts-container');
    div.querySelector('.btn-add-promo-payout').addEventListener('click', () => this.addPromoPayoutRow(payoutsContainer));

    const payouts = (promo && Array.isArray(promo.payouts) && promo.payouts.length > 0)
      ? promo.payouts
      : [{ type: 'percent', value: 300, afterPaymentMonth: 1 }];
    payouts.forEach(p => this.addPromoPayoutRow(payoutsContainer, p));

    lucide.createIcons();
  }

  addPromoPayoutRow(payoutsContainer, payout = null) {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 promo-payout-row';
    row.innerHTML = `
      <select class="promo-type px-2 py-1.5 bg-slate-50 border border-slate-300 rounded text-xs">
        <option value="percent">월초 대비 (%)</option>
        <option value="amount">고정 금액 (원)</option>
      </select>
      <input type="text" inputmode="numeric" class="promo-value px-2 py-1.5 bg-slate-50 border border-slate-300 rounded text-xs w-24" placeholder="수치" value="${payout && payout.value ? Number(payout.value).toLocaleString('en-US') : ''}" oninput="formatMoneyInput(this)">
      <input type="number" class="promo-month px-2 py-1.5 bg-slate-50 border border-slate-300 rounded text-xs w-24" placeholder="납입회차" value="${payout ? payout.afterPaymentMonth : 1}" min="1" max="60" title="N 회차 납입 후 익월 지급">
      <span class="text-[10px] text-slate-500 whitespace-nowrap">회차 납입 후 익월</span>
      <button type="button" class="btn-remove-promo-payout ml-auto text-rose-400 hover:text-rose-600 p-1">
        <i data-lucide="x" class="w-3.5 h-3.5"></i>
      </button>
    `;
    payoutsContainer.appendChild(row);
    if (payout && payout.type) row.querySelector('.promo-type').value = payout.type;

    row.querySelector('.btn-remove-promo-payout').addEventListener('click', () => {
      if (payoutsContainer.querySelectorAll('.promo-payout-row').length > 1) {
        row.remove();
      } else {
        alert('프로모션 하나에는 최소 1개의 지급 회차가 있어야 합니다. 전체 삭제하려면 프로모션 카드의 휴지통 버튼을 사용하세요.');
      }
    });
    lucide.createIcons();
  }

  openModal(contractId = null) {
    this.contractForm.reset();
    this.promotionsContainer.innerHTML = '';
    document.getElementById('form-id').value = '';
    this.terminationWrapper.classList.add('hidden');

    const surrenderInput = document.getElementById('form-surrenderValue16');

    if (contractId) {
      const contract = this.contracts.find(c => c.id === contractId);
      if (contract) {
        this.modalTitle.textContent = '보험계약 수정 (상태 및 환수 관리)';
        document.getElementById('form-id').value = contract.id;
        // 기존 계약 수정 시엔 이미 기록된 해약환급금 값을 보존하고, 보험료를 고쳐도 자동계산으로 덮어쓰지 않음
        surrenderInput.dataset.manual = 'true';
        
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
        document.getElementById('form-premium').value = contract.premium ? Number(contract.premium).toLocaleString('en-US') : '';
        document.getElementById('form-paymentYears').value = contract.paymentYears || 20;
        document.getElementById('form-tp').value = contract.tp ? Number(contract.tp).toLocaleString('en-US') : '';
        document.getElementById('form-surrenderValue16').value = Number(contract.surrenderValue16 || 0).toLocaleString('en-US');
        document.getElementById('form-memo').value = contract.memo || '';

        if (contract.promotions && contract.promotions.length > 0) {
          GfcAdvancedEngine.normalizePromotions(contract.promotions).forEach(g => this.addPromoGroup(g));
        } else {
          this.addPromoGroup();
        }
      }
    } else {
      this.modalTitle.textContent = '새 보험계약 등록 (상태 및 환수 관리)';
      document.getElementById('form-startDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('form-productGroup').value = '건강/상해보험';
      document.getElementById('form-paymentYears').value = 20;
      document.getElementById('form-status').value = '정상유지';
      surrenderInput.value = 0;
      surrenderInput.dataset.manual = 'false';
      this.addPromoGroup({ name: '', payouts: [{ type: 'percent', value: 300, afterPaymentMonth: 1 }] });
    }

    this.modal.classList.remove('hidden');
    lucide.createIcons();
    this.updateSelfVerdictPanel();
  }

  // 자기계약 폼에서 입력값이 바뀔 때마다 "16회차 해지를 전제로 이 계약이 유리한가"를 실시간으로 계산해 보여줌.
  // 계약 자체 손익뿐 아니라, 이 계약의 TP가 그 달 다른 계약들과 합쳐지며 늘어나는 신인/시니어 지원금(문턱효과)까지 함께 반영.
  updateSelfVerdictPanel() {
    const checkedType = this.contractForm.querySelector('input[name="contractType"]:checked');
    if (!checkedType || checkedType.value !== '자기계약') {
      this.selfVerdictPanel.classList.add('hidden');
      return;
    }

    const startDateVal = document.getElementById('form-startDate').value;
    const premium = Number(document.getElementById('form-premium').value.replace(/,/g, '')) || 0;
    const tp = Number(document.getElementById('form-tp').value.replace(/,/g, '')) || 0;
    const surrenderValue16 = Number(document.getElementById('form-surrenderValue16').value.replace(/,/g, '')) || 0;
    const productGroup = document.getElementById('form-productGroup').value;

    if (!startDateVal || premium <= 0 || tp <= 0) {
      this.selfVerdictPanel.classList.add('hidden');
      return;
    }

    const promoGroups = this.promotionsContainer.querySelectorAll('.promo-group');
    const promotions = [];
    promoGroups.forEach(group => {
      const name = this.getPromoGroupName(group);
      const payoutRows = group.querySelectorAll('.promo-payout-row');
      const payouts = [];
      payoutRows.forEach(row => {
        payouts.push({
          type: row.querySelector('.promo-type').value,
          value: Number(String(row.querySelector('.promo-value').value || '').replace(/,/g, '')) || 0,
          afterPaymentMonth: Number(row.querySelector('.promo-month').value) || 1
        });
      });
      if (payouts.length > 0) promotions.push({ name: name || '프로모션', payouts });
    });

    const editingId = document.getElementById('form-id').value || '__preview__';
    const candidate = { id: editingId, productGroup, premium, tp, surrenderValue16, startDate: startDateVal, promotions };

    const result = GfcAdvancedEngine.evaluateSelfContractDecision(candidate, this.contracts, this.settings.joinDate, this.selectClubTier.value || 'club_350');
    if (!result) {
      this.selfVerdictPanel.classList.add('hidden');
      return;
    }

    // 이 계약을 추가했을 때 "자기계약 안전선"(신인/시니어 기준 + 과거·향후 평균) 비율이 어떻게 바뀌는지도 함께 계산
    const clubKeyForSafety = this.selectClubTier.value || 'club_350';
    const scheduleCandidate = { ...candidate, contractType: '자기계약', status: '정상유지' };
    const contractsWithoutCandidate = this.contracts.filter(c => c.id !== editingId);
    const contractsWithCandidate = [...contractsWithoutCandidate, scheduleCandidate];
    const beforeSnap = GfcAdvancedEngine.calculateTrailingSafetySnapshot(contractsWithoutCandidate, this.settings.joinDate, clubKeyForSafety);
    const afterSnap = GfcAdvancedEngine.calculateTrailingSafetySnapshot(contractsWithCandidate, this.settings.joinDate, clubKeyForSafety);
    const { safeThreshold: SAFE_T, cautionThreshold: CAUTION_T } = afterSnap; // joinDate 기준이라 before/after 동일
    const beforeRatio = beforeSnap.ratio;
    const afterRatio = afterSnap.ratio;
    const labelOf = (r) => (r <= SAFE_T ? '안전' : (r <= CAUTION_T ? '주의' : '위험'));
    const colorOf = (r) => (r <= SAFE_T ? 'text-emerald-700' : (r <= CAUTION_T ? 'text-amber-700' : 'text-rose-700'));
    const beforePct = Math.round(beforeRatio * 1000) / 10;
    const afterPct = Math.round(afterRatio * 1000) / 10;
    const worsened = labelOf(afterRatio) !== labelOf(beforeRatio) && afterRatio > beforeRatio;
    const safetyWindowLabel = `최근 ${afterSnap.pastMonths}개월+향후 ${afterSnap.futureMonths}개월`;

    const isGood = result.verdict === 'good';
    // 30만 기준선 또는 현재 Club 등급 유지에 필수적인 계약이면, 단순 금액 손익과 별개로 강조 표시
    const isCritical = result.essentialFor30 || result.essentialForCurrentClub || result.crossedTiers.length > 0;
    const panelColor = isCritical ? 'bg-amber-50 border-amber-400' : (isGood ? 'bg-emerald-50 border-emerald-400' : 'bg-rose-50 border-rose-400');

    this.selfVerdictPanel.classList.remove('hidden');
    this.selfVerdictPanel.className = `p-4 rounded-xl border-2 space-y-2 transition ${panelColor}`;

    let criticalBadges = '';
    if (result.essentialFor30) {
      criticalBadges += `<div class="p-2 rounded-lg bg-amber-100 border border-amber-400 text-amber-900 text-[11px] font-bold flex items-center gap-1.5"><i data-lucide="alert-triangle" class="w-3.5 h-3.5 shrink-0"></i>이 계약이 없으면 이번 달 TP가 30만 미만입니다 — GFC 활동 유지 최소 기준 미달 위험 (단순 손익 계산을 넘어서는 중요한 계약)</div>`;
    } else if (result.stillBelow30) {
      criticalBadges += `<div class="p-2 rounded-lg bg-slate-100 border border-slate-300 text-slate-600 text-[11px]">이 계약을 포함해도 이번 달 TP가 아직 30만 미만입니다 (${result.monthTP.toLocaleString()}원)</div>`;
    }
    if (result.essentialForCurrentClub) {
      criticalBadges += `<div class="p-2 rounded-lg bg-amber-100 border border-amber-400 text-amber-900 text-[11px] font-bold flex items-center gap-1.5"><i data-lucide="award" class="w-3.5 h-3.5 shrink-0"></i>이 계약이 없으면 현재 설정된 Club 등급 유지 기준(${result.monthTP.toLocaleString()}원 필요)에 못 미칩니다</div>`;
    }
    if (result.crossedTiers.length > 0) {
      criticalBadges += `<div class="p-2 rounded-lg bg-amber-100 border border-amber-400 text-amber-900 text-[11px] font-bold flex items-center gap-1.5"><i data-lucide="trending-up" class="w-3.5 h-3.5 shrink-0"></i>이 계약으로 새로 도달하는 Club 등급: ${result.crossedTiers.join(', ')}</div>`;
    }

    this.selfVerdictPanel.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <span class="font-bold ${isGood ? 'text-emerald-800' : 'text-rose-800'} text-sm flex items-center gap-1.5">
          <i data-lucide="${isGood ? 'thumbs-up' : 'thumbs-down'}" class="w-4 h-4 shrink-0"></i>
          16회차 해지 가정 시 ${isGood ? '유리한' : '불리한'} 자기계약으로 보입니다
        </span>
        <span class="font-extrabold text-lg shrink-0 ${isGood ? 'text-emerald-700' : 'text-rose-700'}">${result.netProfitAt16 >= 0 ? '+' : ''}${result.netProfitAt16.toLocaleString()}원</span>
      </div>
      ${criticalBadges}
      <div class="grid grid-cols-2 gap-1.5 text-[11px] text-slate-700">
        <div>15회 납입지출: <strong class="text-rose-600">-${result.totalExpense15.toLocaleString()}원</strong></div>
        <div>수수료+프로모션(공제후): <strong class="text-emerald-600">+${result.totalIncomeNet.toLocaleString()}원</strong></div>
        <div>16회 해약환급금: <strong class="text-blue-600">+${result.surrender16.toLocaleString()}원</strong></div>
        <div>이 계약의 TP 지원금 증분: <strong class="text-emerald-600">+${result.tpBonusDiff.toLocaleString()}원</strong></div>
        ${result.healthBonusClawback > 0 ? `<div class="col-span-2">건강상해보너스 환수: <strong class="text-rose-600">-${result.healthBonusClawback.toLocaleString()}원</strong></div>` : ''}
        ${result.generalPromoClawback > 0 ? `<div class="col-span-2">기타 프로모션 환수(13회차 이후 지급분): <strong class="text-rose-600">-${result.generalPromoClawback.toLocaleString()}원</strong></div>` : ''}
      </div>
      <div class="pt-1.5 border-t ${isGood ? 'border-emerald-200' : 'border-rose-200'} text-[11px] text-slate-600">
        이 계약 등록월 TP 문턱효과: 제외 시 ${result.otherTP.toLocaleString()}원(지원금 ${result.bonusWithout.toLocaleString()}원) → 포함 시 ${result.monthTP.toLocaleString()}원(지원금 ${result.bonusWith.toLocaleString()}원)
      </div>
      <div class="pt-1.5 border-t ${isGood ? 'border-emerald-200' : 'border-rose-200'} text-[11px] text-slate-700 space-y-1">
        <div class="flex items-center justify-between gap-2">
          <span>자기계약 안전선 영향 (${safetyWindowLabel} 평균, ${afterSnap.isSenior ? '경력' : '신인'} 기준)</span>
          <span>${beforePct}% (${labelOf(beforeRatio)}) → <strong class="${colorOf(afterRatio)}">${afterPct}% (${labelOf(afterRatio)})</strong></span>
        </div>
        ${worsened ? `<div class="p-2 rounded-lg bg-rose-100 border border-rose-300 text-rose-800 text-[11px] font-semibold flex items-center gap-1.5"><i data-lucide="alert-triangle" class="w-3.5 h-3.5 shrink-0"></i>이 계약을 추가하면 안전선 등급이 '${labelOf(beforeRatio)}'에서 '${labelOf(afterRatio)}'(으)로 나빠집니다.</div>` : ''}
      </div>
    `;
    lucide.createIcons();
  }

  closeModal() {
    this.modal.classList.add('hidden');
  }

  async handleFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('form-id').value;

    const promoGroups = this.promotionsContainer.querySelectorAll('.promo-group');
    const promotions = [];
    promoGroups.forEach(group => {
      const name = this.getPromoGroupName(group);
      const payoutRows = group.querySelectorAll('.promo-payout-row');
      const payouts = [];
      payoutRows.forEach(row => {
        payouts.push({
          type: row.querySelector('.promo-type').value,
          value: Number(String(row.querySelector('.promo-value').value || '').replace(/,/g, '')) || 0,
          afterPaymentMonth: Number(row.querySelector('.promo-month').value) || 1
        });
      });
      if (payouts.length > 0) {
        promotions.push({ name: name || '프로모션', payouts });
      }
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
      premium: Number(document.getElementById('form-premium').value.replace(/,/g, '')) || 0,
      paymentYears: Number(document.getElementById('form-paymentYears').value) || 20,
      tp: Number(document.getElementById('form-tp').value.replace(/,/g, '')) || 0,
      surrenderValue16: Number(document.getElementById('form-surrenderValue16').value.replace(/,/g, '')) || 0,
      promotions: promotions,
      memo: document.getElementById('form-memo').value.trim()
    };

    if (!contractData.client || !contractData.title || contractData.premium < 0) {
      alert('필수 입력값이 누락되었거나 잘못된 형식입니다. (계약자명/상품명/보험료를 확인해주세요)');
      return;
    }

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
      this.settings = await ContractStore.getSettings();
      this.closeModal();
      this.renderAll();
    } catch (e) {
      console.error('Save error:', e);
      alert('저장 실패: ' + e.message);
    }
  }

  async deleteContract(id) {
    if (confirm('해당 계약 항목을 삭제하시겠습니까? (DB에는 보관되며, 최근 삭제 3건까지는 다시 불러올 수 있습니다)')) {
      try {
        await ContractStore.deleteContractFromSupabase(id);
        this.contracts = await ContractStore.getContractsFromSupabase();
        this.recentlyDeleted = await ContractStore.getRecentlyDeletedFromSupabase(10);
        this.renderAll();
      } catch (e) {
        alert('삭제 실패: ' + e.message);
      }
    }
  }

  // 최근 삭제 목록(최대 10개, DB 조회)에서 계약을 원래 상태로 복원한다.
  async restoreContract(id) {
    try {
      await ContractStore.restoreContractInSupabase(id);
      this.contracts = await ContractStore.getContractsFromSupabase();
      this.recentlyDeleted = await ContractStore.getRecentlyDeletedFromSupabase(10);
      this.renderAll();
    } catch (e) {
      alert('복원 실패: ' + e.message);
    }
  }

  // 삭제 목록에서 완전 삭제 (DB 행 자체를 영구 제거, 복원 불가)
  async permanentlyDeleteContract(id) {
    if (!confirm('이 계약을 완전히 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    try {
      await ContractStore.permanentlyDeleteContract(id);
      this.recentlyDeleted = await ContractStore.getRecentlyDeletedFromSupabase(10);
      this.renderAll();
    } catch (e) {
      alert('완전 삭제 실패: ' + e.message);
    }
  }

  // 대시보드에는 열기/닫기 버튼만 노출하고, 클릭 시에만 삭제된 계약 리스트를 펼쳐서 보여준다.
  toggleDeletedContractsPanel() {
    const isHidden = this.deletedContractsPanel.classList.contains('hidden');
    this.deletedContractsPanel.classList.toggle('hidden');
    this.deletedListChevron.classList.toggle('rotate-180', isHidden);
    if (isHidden) this.renderDeletedContractsList();
  }

  renderRecentlyDeleted() {
    if (!this.deletedListToggleLabel) return;
    const count = this.recentlyDeleted.length;
    this.deletedListToggleLabel.textContent = count > 0 ? `삭제된 계약 (${count})` : '삭제된 계약';
    // 패널이 열려 있는 상태라면 목록 내용도 즉시 갱신
    if (this.deletedContractsPanel && !this.deletedContractsPanel.classList.contains('hidden')) {
      this.renderDeletedContractsList();
    }
  }

  renderDeletedContractsList() {
    if (!this.deletedContractsList) return;
    if (this.recentlyDeleted.length === 0) {
      this.deletedContractsList.innerHTML = `<p class="text-slate-400 text-center py-2">삭제된 계약이 없습니다.</p>`;
      lucide.createIcons();
      return;
    }
    this.deletedContractsList.innerHTML = this.recentlyDeleted.map(c => {
      const deletedDateStr = c.deletedAt ? new Date(c.deletedAt).toLocaleDateString('ko-KR') : '';
      return `
        <div class="flex items-center justify-between gap-3 px-3 py-2 bg-white border border-amber-200 rounded-lg">
          <div class="min-w-0">
            <p class="font-semibold text-slate-700 truncate">${c.title || '계약'} <span class="text-slate-400 font-normal">· ${c.client || ''}</span></p>
            <p class="text-[11px] text-slate-400">${c.company || ''} · 보험료 ${(Number(c.premium) || 0).toLocaleString()}원${deletedDateStr ? ' · 삭제일 ' + deletedDateStr : ''}</p>
          </div>
          <div class="shrink-0 flex items-center gap-1.5">
            <button type="button" onclick="app.restoreContract('${c.id}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-300 rounded-full text-amber-800 hover:bg-amber-100 transition" title="다시 불러오기">
              <i data-lucide="rotate-ccw" class="w-3 h-3"></i> 복원
            </button>
            <button type="button" onclick="app.permanentlyDeleteContract('${c.id}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-rose-50 border border-rose-300 rounded-full text-rose-700 hover:bg-rose-100 transition" title="완전 삭제 (복원 불가)">
              <i data-lucide="x" class="w-3 h-3"></i> 완전삭제
            </button>
          </div>
        </div>
      `;
    }).join('');
    lucide.createIcons();
  }

}

// Global App Instance
let app = null;

document.addEventListener('DOMContentLoaded', () => {
  app = new AppUI();
});