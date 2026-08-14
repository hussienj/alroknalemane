
import type { SchoolSettings, Subject } from './types.ts';
import { v4 as uuidv4 } from 'uuid';

export const SCHOOL_TYPES = ['نهاري', 'مسائي', 'خارجي'];
export const SCHOOL_GENDERS = ['بنين', 'بنات', 'مختلط'];
export const SCHOOL_LEVELS = ['ابتدائية', 'متوسطة', 'اعدادية', 'ثانوية', 'اعدادي علمي', 'اعدادي ادبي', 'ثانوية علمي', 'ثانوية ادبي'];
export const GOVERNORATES = [
    'دهوك', 'نينوى', 'اربيل', 'السليمانية', 'كركوك', 'حلبجة',
    'صلاح الدين', 'ديالى', 'الأنبار', 'بغداد', 'كربلاء',
    'واسط', 'بابل', 'النجف', 'القادسية', 'ميسان',
    'المثنى', 'ذي قار', 'البصرة'
];

export const DEFAULT_SCHOOL_SETTINGS: SchoolSettings = {
    schoolName: '',
    principalName: '',
    academicYear: '2025-2026',
    directorate: '',
    supplementarySubjectsCount: 3,
    decisionPoints: 5,
    // New fields
    principalPhone: '',
    schoolType: 'نهاري',
    schoolGender: 'بنين',
    schoolLevel: 'متوسطة',
    governorateCode: '',
    schoolCode: '',
    governorateName: 'بغداد',
    district: '',
    subdistrict: '',
    // Submission lock defaults
    lockS1Submissions: false,
    lockS2Submissions: false,
    lockAllSubmissions: false,
    // Results notice default
    monthlyResultsNotice: false,
};

export const GRADE_LEVELS: string[] = [
    'الاول ابتدائي', 'الثاني ابتدائي', 'الثالث ابتدائي', 'الرابع ابتدائي', 'الخامس ابتدائي', 'السادس ابتدائي',
    'الاول متوسط', 'الثاني متوسط', 'الثالث متوسط',
    'الرابع العلمي', 'الرابع الادبي',
    'الخامس العلمي', 'الخامس الادبي',
    'السادس العلمي', 'السادس الادبي'
];

const generateSubjects = (names: string[]): Subject[] => names.map(name => ({ id: uuidv4(), name }));

export const DEFAULT_SUBJECT_GRADE_OBJECT = {
    firstTerm: null, midYear: null, secondTerm: null, finalExam1st: null, finalExam2nd: null,
    october: null, november: null, december: null, january: null, february: null, march: null, april: null
};

export const ensureDefaultSportsAndArtSubjects = (subjects: Subject[] = []): Subject[] => {
    let list = [...subjects];

    // Convert old names if present
    list = list.map(s => {
        if (s.name === 'التربية الرياضية') return { ...s, name: 'الرياضة' };
        if (s.name === 'التربية الفنية') return { ...s, name: 'الفنية' };
        return s;
    });

    // Find or create "الرياضة"
    let sportsSub = list.find(s => s.name === 'الرياضة');
    if (!sportsSub) {
        sportsSub = { id: uuidv4(), name: 'الرياضة' };
    }

    // Find or create "الفنية"
    let artSub = list.find(s => s.name === 'الفنية');
    if (!artSub) {
        artSub = { id: uuidv4(), name: 'الفنية' };
    }

    // Keep all academic subjects excluding "الرياضة" and "الفنية"
    const academicSubs = list.filter(s => s.name !== 'الرياضة' && s.name !== 'الفنية');

    // Place "الرياضة" then "الفنية" strictly at the end after the last subject
    return [...academicSubs, sportsSub, artSub];
};

export const DEFAULT_SUBJECTS: Record<string, Subject[]> = {
    'الاول ابتدائي': generateSubjects(['التربية الاسلامية', 'القراءة', 'اللغة الانكليزية', 'الرياضيات', 'العلوم', 'الرياضة', 'الفنية']),
    'الثاني ابتدائي': generateSubjects(['التربية الاسلامية', 'القراءة', 'اللغة الانكليزية', 'الرياضيات', 'العلوم', 'الرياضة', 'الفنية']),
    'الثالث ابتدائي': generateSubjects(['التربية الاسلامية', 'القراءة', 'اللغة الانكليزية', 'الرياضيات', 'العلوم', 'الرياضة', 'الفنية']),
    'الرابع ابتدائي': generateSubjects(['التربية الاسلامية', 'اللغة العربية', 'اللغة الانكليزية', 'الرياضيات', 'الاجتماعيات', 'العلوم', 'الرياضة', 'الفنية']),
    'الخامس ابتدائي': generateSubjects(['التربية الاسلامية', 'اللغة العربية', 'اللغة الانكليزية', 'الرياضيات', 'الاجتماعيات', 'العلوم', 'الرياضة', 'الفنية']),
    'السادس ابتدائي': generateSubjects(['التربية الاسلامية', 'اللغة العربية', 'اللغة الانكليزية', 'الرياضيات', 'الاجتماعيات', 'العلوم', 'الرياضة', 'الفنية']),
    'الاول متوسط': generateSubjects(['التربية الاسلامية', 'اللغة العربية', 'اللغة الإنكليزية', 'الاجتماعيات', 'الرياضيات', 'الحاسوب', 'الفيزياء', 'الكيمياء', 'الاحياء', 'الاخلاقية', 'الرياضة', 'الفنية']),
    'الثاني متوسط': generateSubjects(['التربية الاسلامية', 'اللغة العربية', 'اللغة الإنكليزية', 'الاجتماعيات', 'الرياضيات', 'الحاسوب', 'الفيزياء', 'الكيمياء', 'الاحياء', 'الاخلاقية', 'الرياضة', 'الفنية']),
    'الثالث متوسط': generateSubjects(['التربية الاسلامية', 'اللغة العربية', 'اللغة الإنكليزية', 'الاجتماعيات', 'الرياضيات', 'الفيزياء', 'الكيمياء', 'الاحياء', 'الرياضة', 'الفنية']),
    'الرابع العلمي': generateSubjects(['التربية الاسلامية', 'اللغة العربية', 'اللغة الانكليزية', 'الرياضيات', 'الحاسوب', 'الفيزياء', 'الكيمياء', 'الاحياء', 'الرياضة', 'الفنية']),
    'الرابع الادبي': generateSubjects(['التربية الاسلامية', 'اللغة العربية', 'اللغة الانكليزية', 'التاريخ', 'الجغرافية', 'علم الاجتماع', 'الرياضيات', 'الحاسوب', 'الرياضة', 'الفنية']),
    'الخامس العلمي': generateSubjects(['التربية الاسلامية', 'اللغة العربية', 'اللغة الانكليزية', 'الرياضيات', 'الحاسوب', 'الفيزياء', 'الكيمياء', 'الاحياء', 'علم الارض', 'الرياضة', 'الفنية']),
    'الخامس الادبي': generateSubjects(['التربية الاسلامية', 'اللغة العربية', 'اللغة الانكليزية', 'التاريخ', 'الجغرافية', 'الرياضيات', 'الحاسوب', 'الاقتصاد', 'الفلسفة وعلم النفس', 'الرياضة', 'الفنية']),
    'السادس العلمي': generateSubjects(['التربية الاسلامية', 'اللغة العربية', 'اللغة الانكليزية', 'الاجتماعيات', 'الرياضيات', 'الحاسوب', 'الفيزياء', 'الكيمياء', 'الاحياء', 'الرياضة', 'الفنية']),
    'السادس الادبي': generateSubjects(['التربية الاسلامية', 'اللغة العربية', 'اللغة الانكليزية', 'التاريخ', 'الجغرافية', 'الرياضيات', 'الحاسوب', 'الاقتصاد', 'الرياضة', 'الفنية']),
};

// FIX: Add missing BEHAVIORAL_CRITERIA constant.
export const BEHAVIORAL_CRITERIA = [
  { key: 'respect', label: 'الاحترام', description: 'يظهر احترامًا للمعلمين والزملاء.' },
  { key: 'cooperation', label: 'التعاون', description: 'يتعاون مع الآخرين في الأنشطة الصفية.' },
  { key: 'responsibility', label: 'المسؤولية', description: 'يتحمل مسؤولية واجباته وممتلكاته.' },
  { key: 'discipline', label: 'الانضباط', description: 'يلتزم بقوانين المدرسة والنظام داخل الصف.' },
  { key: 'initiative', label: 'المبادرة', description: 'يبادر في المساعدة وتقديم الأفكار الإيجابية.' },
  { key: 'integrity', label: 'النزاهة', description: 'يتمتع بالصدق والأمانة في تعاملاته.' },
];
