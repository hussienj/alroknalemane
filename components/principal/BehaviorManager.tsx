

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../lib/firebase.ts';
import type { User, SchoolSettings, ClassData, Student, BehaviorDeduction, StudentNotification } from '../../types.ts';
import { Loader2, ShieldBan, Send, AlertTriangle, CheckCircle2, Trash2, Users, Bot, X, Bell, History } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { sendTelegramNotification, TelegramConfig } from '../../lib/telegram.ts';

interface BehaviorManagerProps {
    principal: User;
    settings: SchoolSettings;
    classes: ClassData[];
}

export default function BehaviorManager({ principal, settings, classes }: BehaviorManagerProps) {
    const [selectedStage, setSelectedStage] = useState('');
    const [selectedClassId, setSelectedClassId] = useState('');
    const [allDeductions, setAllDeductions] = useState<Record<string, BehaviorDeduction[]>>({});
    const [isLoading, setIsLoading] = useState(true);
    
    const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
    const [deductionAmount, setDeductionAmount] = useState<5 | 10 | 15 | 0>(5);
    const [deductionReason, setDeductionReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Telegram State
    const [sendIndividualTelegram, setSendIndividualTelegram] = useState(true);
    const [sendGroupTelegram, setSendGroupTelegram] = useState(true);
    const [customGroupChatId, setCustomGroupChatId] = useState(settings?.telegramDefaultChatId || '');
    const [isSendingTelegram, setIsSendingTelegram] = useState(false);
    const [telegramLogModal, setTelegramLogModal] = useState<{ open: boolean; title: string; logs: string[] } | null>(null);

    // Keep customGroupChatId synchronized if settings change
    useEffect(() => {
        if (settings?.telegramDefaultChatId) {
            setCustomGroupChatId(prev => prev || settings.telegramDefaultChatId || '');
        }
    }, [settings?.telegramDefaultChatId]);

    const telegramConfig: TelegramConfig = useMemo(() => ({
        botToken: settings?.telegramBotToken,
        defaultChatId: customGroupChatId || settings?.telegramDefaultChatId,
        enabled: settings?.telegramEnabled
    }), [settings, customGroupChatId]);

    useEffect(() => {
        setIsLoading(true);
        const deductionsRef = db.ref(`behavior_deductions/${principal.id}`);
        const callback = (snapshot: any) => {
            const data = snapshot.val() || {};
            const deductionsByStudent: Record<string, BehaviorDeduction[]> = {};
            Object.keys(data).forEach(studentId => {
                deductionsByStudent[studentId] = Object.values(data[studentId]);
            });
            setAllDeductions(deductionsByStudent);
            setIsLoading(false);
        };
        deductionsRef.on('value', callback);
        return () => deductionsRef.off('value', callback);
    }, [principal.id]);
    
    const selectedClass = useMemo(() => classes.find(c => c.id === selectedClassId), [classes, selectedClassId]);
    const studentLabel = settings.schoolLevel === 'ابتدائية' ? 'التلميذ' : 'الطالب';

    const studentTotals = useMemo(() => {
        const totals: Record<string, number> = {};
        Object.entries(allDeductions).forEach(([studentId, deductions]) => {
            totals[studentId] = (deductions as BehaviorDeduction[]).reduce((sum, d) => sum + d.pointsDeducted, 0);
        });
        return totals;
    }, [allDeductions]);

    const handleDeduct = async (mode: 'save_and_notify' | 'save_only' = 'save_and_notify') => {
        if (!selectedStudentId || !deductionReason.trim() || !selectedClass) {
            alert('يرجى اختيار طالب وكتابة سبب الخصم.');
            return;
        }
        setIsSubmitting(true);
        const student = selectedClass.students.find(s => s.id === selectedStudentId);
        if (!student) {
            setIsSubmitting(false);
            return;
        }

        const newDeduction: BehaviorDeduction = {
            id: uuidv4(),
            principalId: principal.id,
            studentId: selectedStudentId,
            classId: selectedClassId,
            pointsDeducted: deductionAmount,
            reason: deductionReason.trim(),
            timestamp: new Date().toISOString()
        };
        
        const noticeMessage = deductionAmount > 0
            ? `تنبيه سلوك\nالتاريخ: ${new Date().toLocaleDateString('ar-EG')}\nإلى ولي أمر ${studentLabel} / ${student.name}\nالصف والشعبة: ${selectedClass.stage} / ${selectedClass.section}\n\nنود إبلاغكم بأن ${studentLabel} (${student.name}) قد صدر منه سلوك غير لائق داخل المدرسة بتاريخ ${new Date().toLocaleDateString('ar-EG')}، تمثل في (${deductionReason.trim()}). وبناءً عليه تم خصم ${deductionAmount} درجات من رصيد سلوكه.\n\nتوقيع إدارة المدرسة`
            : `تنبيه سلوك\nالتاريخ: ${new Date().toLocaleDateString('ar-EG')}\nإلى ولي أمر ${studentLabel} / ${student.name}\nالصف والشعبة: ${selectedClass.stage} / ${selectedClass.section}\n\nنود إبلاغكم بأن ${studentLabel} (${student.name}) قد صدر منه سلوك غير لائق داخل المدرسة بتاريخ ${new Date().toLocaleDateString('ar-EG')}، تمثل في (${deductionReason.trim()}). وبناءً عليه تم تنبيهه وتوجيهه وفي حال تكرار المخالفة سوف يتم الخصم من درجات السلوك.\n\nتوقيع إدارة المدرسة`;

        const newNotification: Omit<StudentNotification, 'id'> = {
            studentId: selectedStudentId,
            message: noticeMessage,
            timestamp: new Date().toISOString(),
            isRead: false
        };

        const logs: string[] = [];

        try {
            await db.ref(`behavior_deductions/${principal.id}/${selectedStudentId}/${newDeduction.id}`).set(newDeduction);
            await db.ref(`student_notifications/${principal.id}/${selectedStudentId}`).push(newNotification);
            
            logs.push(deductionAmount > 0 
                ? `✅ تم خصم (${deductionAmount}) درجات وحفظ الإجراء بنجاح في النظام للطالب (${student.name}).` 
                : `✅ تم تسجيل التنبيه السلوكي وحفظ الإجراء بنجاح في النظام للطالب (${student.name}).`
            );

            if (mode === 'save_and_notify') {
                if (!settings?.telegramBotToken?.trim()) {
                    logs.push('❌ لم يتم إدخال توكن بوت التليكرام في إعدادات النظام. يمكنك تفعيل البوت من صفحة (الإعدادات).');
                } else {
                    // 1. Send Individual Telegram Notification
                    if (sendIndividualTelegram) {
                        const chatId = student.telegramChatId?.trim();
                        if (chatId) {
                            const actionTitle = deductionAmount > 0 ? `خصم (${deductionAmount}) درجات من السلوك` : 'تنبيه سلوكي مسبق';
                            const indMsg = 
                                `<b>⚠️ تنبيه سلوك طالب</b>\n\n` +
                                `<b>اسم الطالب:</b> ${student.name}\n` +
                                `<b>الصف والشعبة:</b> ${selectedClass.stage} / ${selectedClass.section}\n` +
                                `<b>التاريخ:</b> ${new Date().toLocaleDateString('ar-EG')}\n` +
                                `<b>نوع الإجراء:</b> ${actionTitle}\n` +
                                `<b>سبب الإجراء:</b> ${deductionReason.trim()}\n\n` +
                                `نسترعي انتباه ولي الأمر الموقر لمتابعة سلوك الطالب والتأكد من التزامه بضوابط وأنظمة المدرسة.\n\n` +
                                `<i>إدارة المدرسة - معاونية شؤون الطلبة</i>`;

                            const resInd = await sendTelegramNotification(telegramConfig, chatId, indMsg);
                            if (resInd.success) {
                                logs.push(`✅ تم إرسال إشعار التليكرام الفردي إلى ولي أمر الطالب/ة (${student.name}) بنجاح (ID: ${chatId}).`);
                            } else {
                                logs.push(`❌ فشل إرسال التليكرام الفردي إلى (${student.name}): ${resInd.error}`);
                            }
                        } else {
                            logs.push(`⚠️ الطالب/ة (${student.name}) غير مرتبط بآيدي التليكرام (Chat ID).`);
                        }
                    }

                    // 2. Send Group Telegram Notification
                    if (sendGroupTelegram) {
                        const targetGroupId = customGroupChatId.trim() || settings?.telegramDefaultChatId?.trim();
                        if (targetGroupId) {
                            const actionTitle = deductionAmount > 0 ? `خصم (${deductionAmount}) درجات من السلوك` : 'تنبيه سلوكي';
                            const groupMsg = 
                                `<b>📢 تنبيه سلوكي / إشعار انضباط</b>\n\n` +
                                `<b>اسم الطالب:</b> ${student.name}\n` +
                                `<b>الصف والشعبة:</b> ${selectedClass.stage} - ${selectedClass.section}\n` +
                                `<b>التاريخ:</b> ${new Date().toLocaleDateString('ar-EG')}\n` +
                                `<b>الإجراء المتخذ:</b> ${actionTitle}\n` +
                                `<b>السبب:</b> ${deductionReason.trim()}\n\n` +
                                `<i>إدارة المدرسة - معاونية شؤون الطلبة</i>`;

                            const resGrp = await sendTelegramNotification(telegramConfig, targetGroupId, groupMsg);
                            if (resGrp.success) {
                                logs.push(`✅ تم نشر التنبيه السلوكي بنجاح في مجموعة التليكرام (${targetGroupId}).`);
                            } else {
                                logs.push(`❌ فشل النشر في مجموعة التليكرام (${targetGroupId}): ${resGrp.error}`);
                            }
                        } else {
                            logs.push(`❌ لم يتم تحديد معرف مجموعة التليكرام (Group Chat ID).`);
                        }
                    }
                }
            }

            setDeductionReason('');
            setTelegramLogModal({
                open: true,
                title: 'تقرير إشعارات السلوك والتليكرام',
                logs
            });
        } catch (error) {
            console.error("Failed to deduct points:", error);
            alert('حدث خطأ أثناء عملية الخصم.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteDeduction = async (studentId: string, deductionId: string) => {
        if (!confirm('هل أنت متاكد من إلغاء هذا الخصم/التنبيه وحذفه من النظام؟')) return;
        try {
            await db.ref(`behavior_deductions/${principal.id}/${studentId}/${deductionId}`).remove();
            alert('تم حذف الخصم/التنبيه بنجاح.');
        } catch (error) {
            console.error('Error deleting deduction:', error);
            alert('حدث خطأ أثناء حذف الخصم.');
        }
    };

    const handleSendSingleStudentTelegram = async (student: Student, reason?: string, points?: number) => {
        if (!selectedClass) return;
        const chatId = student.telegramChatId?.trim();

        if (!chatId) {
            alert(`الطالب/ة (${student.name}) غير مرتبط بآيدي التليكرام (Chat ID). يمكنك إضافة آيدي التليكرام له من صفحة (إدارة تليكرام الطلبة).`);
            return;
        }

        if (!settings?.telegramBotToken?.trim()) {
            alert('لم يتم ضبط توكن بوت التليكرام في إعدادات النظام.');
            return;
        }

        setIsSendingTelegram(true);
        const totalDeducted = studentTotals[student.id] || 0;
        const actionText = points !== undefined ? (points > 0 ? `خصم (${points}) درجات` : 'تنبيه سلوكي') : `إجمالي الخصم (${totalDeducted}) درجات`;
        const reasonText = reason || 'متابعة وتنبيه انضباط سلوكي داخل المدرسة';

        const msg = 
            `<b>⚠️ تنبيه سلوك طالب</b>\n\n` +
            `<b>اسم الطالب:</b> ${student.name}\n` +
            `<b>المرحلة والشعبة:</b> ${selectedClass.stage} - ${selectedClass.section}\n` +
            `<b>التاريخ:</b> ${new Date().toLocaleDateString('ar-EG')}\n` +
            `<b>نوع الإجراء:</b> ${actionText}\n` +
            `<b>سبب الإجراء:</b> ${reasonText}\n\n` +
            `نسترعي انتباه ولي الأمر الموقر لمتابعة سلوك الطالب والحرص على انضباطه المدرسي.\n\n` +
            `<i>إدارة المدرسة - معاونية شؤون الطلبة</i>`;

        const res = await sendTelegramNotification(telegramConfig, chatId, msg);
        setIsSendingTelegram(false);

        if (res.success) {
            alert(`تم إرسال إشعار التليكرام الفردي إلى ولي أمر الطالب (${student.name}) بنجاح!`);
        } else {
            alert(`فشل الإرسال إلى الطالب (${student.name}): ${res.error}`);
        }
    };

    const handleSendClassBehaviorSummaryToGroup = async () => {
        if (!selectedClass) return;
        const targetGroupId = customGroupChatId.trim() || settings?.telegramDefaultChatId?.trim();

        if (!targetGroupId) {
            alert('يرجى تحديد معرف مجموعة التليكرام (Group Chat ID).');
            return;
        }

        if (!settings?.telegramBotToken?.trim()) {
            alert('لم يتم ضبط توكن بوت التليكرام في إعدادات النظام.');
            return;
        }

        setIsSendingTelegram(true);
        const logs: string[] = [];

        // Filter students with deductions in selectedClass
        const studentsWithDeductions = (selectedClass.students || []).filter(s => {
            const studentDeductions = allDeductions[s.id] || [];
            return studentDeductions.length > 0;
        });

        if (studentsWithDeductions.length === 0) {
            logs.push('ℹ️ لا يوجد أي خصومات أو تنبيهات سلوكية مسجلة لطلاب هذه الشعبة حتى الآن.');
            setIsSendingTelegram(false);
            setTelegramLogModal({
                open: true,
                title: 'تقرير كشف السلوك الجماعي',
                logs
            });
            return;
        }

        const groupReport = 
            `<b>📋 كشف الملاحظات والخصومات السلوكية</b>\n` +
            `<b>المرحلة والشعبة:</b> ${selectedClass.stage} - ${selectedClass.section}\n` +
            `<b>التاريخ:</b> ${new Date().toLocaleDateString('ar-EG')}\n` +
            `<b>عدد الطلاب المسجل بحقهم خصم:</b> ${studentsWithDeductions.length}\n` +
            `-----------------------------------\n` +
            `<b>قائمة الطلاب والخصومات:</b>\n` +
            studentsWithDeductions.map((s, idx) => {
                const studentDeductions = allDeductions[s.id] || [];
                const totalPoints = studentDeductions.reduce((sum, d) => sum + d.pointsDeducted, 0);
                const latest = studentDeductions[studentDeductions.length - 1];
                return `${idx + 1}. <b>${s.name}</b> - مجموع الخصم: (${totalPoints} درجات)\n   آخر سبب: ${latest ? latest.reason : 'تنبيه انضباط'}`;
            }).join('\n\n') +
            `\n-----------------------------------\n` +
            `<i>إدارة المدرسة - معاونية شؤون الطلبة</i>`;

        const res = await sendTelegramNotification(telegramConfig, targetGroupId, groupReport);
        setIsSendingTelegram(false);

        if (res.success) {
            logs.push(`✅ تم نشر كشف السلوك الجماعي لشعبة (${selectedClass.stage} - ${selectedClass.section}) بنجاح في المجموعة (${targetGroupId}).`);
        } else {
            logs.push(`❌ فشل نشر كشف السلوك في المجموعة (${targetGroupId}): ${res.error}`);
        }

        setTelegramLogModal({
            open: true,
            title: 'تقرير إرسال كشف السلوك للتليكرام',
            logs
        });
    };

    return (
        <div className="bg-white p-6 md:p-8 rounded-2xl shadow-lg space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
                <div className="flex items-center gap-3 text-2xl font-bold text-gray-800">
                    <ShieldBan className="w-8 h-8 text-red-500" />
                    <h2>إدارة درجات السلوك والانضباط</h2>
                </div>
                {settings?.telegramEnabled ? (
                    <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-3 py-1.5 rounded-full border border-emerald-300 flex items-center gap-1.5">
                        <CheckCircle2 size={14} />
                        إشعارات التليكرام مفعّلة
                    </span>
                ) : (
                    <span className="text-xs bg-amber-100 text-amber-800 font-bold px-3 py-1.5 rounded-full border border-amber-300 flex items-center gap-1.5">
                        <AlertTriangle size={14} />
                        التليكرام غير مفعّل في الإعدادات
                    </span>
                )}
            </div>
            
            {/* Stage and Class Selectors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border">
                <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">المرحلة الدراسية:</label>
                    <select 
                        value={selectedStage} 
                        onChange={e => { setSelectedStage(e.target.value); setSelectedClassId(''); setSelectedStudentId(null); }} 
                        className="w-full p-2.5 border rounded-lg bg-white font-semibold shadow-sm focus:ring-2 focus:ring-cyan-500"
                    >
                        <option value="">-- اختر المرحلة --</option>
                        {Array.from(new Set(classes.map(c => c.stage))).map(stage => (
                            <option key={stage} value={stage}>{stage}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">الشعبة:</label>
                    <select 
                        value={selectedClassId} 
                        onChange={e => { setSelectedClassId(e.target.value); setSelectedStudentId(null); }} 
                        disabled={!selectedStage} 
                        className="w-full p-2.5 border rounded-lg bg-white font-semibold shadow-sm focus:ring-2 focus:ring-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
                    >
                        <option value="">-- اختر الشعبة --</option>
                        {classes.filter(c => c.stage === selectedStage).map(c => (
                            <option key={c.id} value={c.id}>{c.section}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Telegram Settings Control Panel */}
            {selectedClass && (
                <div className="bg-gradient-to-br from-slate-50 to-cyan-50/50 p-5 rounded-2xl border border-cyan-200/80 shadow-sm space-y-4">
                    <div className="flex items-center justify-between border-b border-cyan-200/60 pb-3">
                        <div className="flex items-center gap-2">
                            <Send className="text-cyan-600 h-5 w-5" />
                            <h3 className="font-bold text-gray-800 text-base">إعدادات وخيارات إشعارات التليكرام للسلوك</h3>
                        </div>
                        <button
                            type="button"
                            onClick={handleSendClassBehaviorSummaryToGroup}
                            disabled={isSendingTelegram}
                            className="px-3.5 py-1.5 bg-slate-700 hover:bg-slate-800 text-white font-bold text-xs rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                            <Users size={14} />
                            <span>نشر كشف السلوك للمجموعة</span>
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="flex items-start gap-3 p-3 bg-white rounded-xl border border-gray-200 cursor-pointer hover:border-cyan-300 transition-colors">
                            <input 
                                type="checkbox" 
                                checked={sendIndividualTelegram} 
                                onChange={e => setSendIndividualTelegram(e.target.checked)}
                                className="mt-1 h-4 w-4 text-cyan-600 rounded focus:ring-cyan-500"
                            />
                            <div>
                                <span className="font-bold text-gray-800 text-sm block">إرسال إشعار تليكرام فردي للطالب</span>
                                <span className="text-xs text-gray-500">إرسال إشعار خاص مباشر بحساب التليكرام الخاص بولي أمر الطالب عند خصم/تنبيه السلوك</span>
                            </div>
                        </label>

                        <label className="flex items-start gap-3 p-3 bg-white rounded-xl border border-gray-200 cursor-pointer hover:border-cyan-300 transition-colors">
                            <input 
                                type="checkbox" 
                                checked={sendGroupTelegram} 
                                onChange={e => setSendGroupTelegram(e.target.checked)}
                                className="mt-1 h-4 w-4 text-cyan-600 rounded focus:ring-cyan-500"
                            />
                            <div>
                                <span className="font-bold text-gray-800 text-sm block">إرسال إشعار لمجموعة التليكرام العامة</span>
                                <span className="text-xs text-gray-500">نشر تنبيه الانضباط فور خصمه في مجموعة أو قناة المدرسة للتليكرام</span>
                            </div>
                        </label>
                    </div>

                    {sendGroupTelegram && (
                        <div className="bg-white p-3 rounded-xl border border-gray-200">
                            <label className="block text-xs font-bold text-gray-700 mb-1">
                                معرف القناة أو المجموعة في التليكرام (Group Chat ID):
                            </label>
                            <input 
                                type="text"
                                dir="ltr"
                                value={customGroupChatId}
                                onChange={e => setCustomGroupChatId(e.target.value)}
                                placeholder="مثلاً: -1001234567890 أو @school_group"
                                className="w-full text-sm p-2 border rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-cyan-500 font-mono"
                            />
                        </div>
                    )}
                </div>
            )}
            
            {isLoading ? (
                <div className="text-center py-12">
                    <Loader2 className="animate-spin mx-auto text-cyan-600 h-10 w-10 mb-2"/>
                    <p className="text-gray-500 font-semibold">جاري تحميل البيانات...</p>
                </div>
            ) : selectedClass ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Student List Column */}
                    <div className="lg:col-span-5 space-y-3">
                        <div className="flex items-center justify-between bg-gray-100 p-3 rounded-xl">
                            <h3 className="font-bold text-gray-800 text-sm">قائمة {studentLabel === 'الطالب' ? 'الطلاب' : 'التلاميذ'} ({selectedClass.students?.length || 0})</h3>
                            <span className="text-xs text-gray-500">انقر على الطالب للخصم والتنبيه</span>
                        </div>

                        <div className="max-h-[65vh] overflow-y-auto border rounded-xl divide-y bg-white shadow-xs">
                            {(selectedClass.students || []).map(student => {
                                const totalDeducted = studentTotals[student.id] || 0;
                                const isSelected = selectedStudentId === student.id;
                                const isLinked = !!student.telegramChatId && student.telegramChatId.trim() !== '';

                                return (
                                    <div 
                                        key={student.id} 
                                        onClick={() => setSelectedStudentId(student.id)} 
                                        className={`p-3.5 cursor-pointer transition-colors flex items-center justify-between ${
                                            isSelected ? 'bg-cyan-600 text-white shadow-sm' : 'hover:bg-cyan-50/70 text-gray-800'
                                        }`}
                                    >
                                        <div className="space-y-1">
                                            <p className="font-bold text-sm">{student.name}</p>
                                            <div className="flex items-center gap-2">
                                                {isLinked ? (
                                                    <span className={`text-[11px] px-2 py-0.5 rounded flex items-center gap-1 font-mono ${
                                                        isSelected ? 'bg-cyan-700 text-white' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                    }`}>
                                                        <Send size={10} />
                                                        آيدي التليكرام: {student.telegramChatId}
                                                    </span>
                                                ) : (
                                                    <span className={`text-[10px] px-2 py-0.5 rounded ${
                                                        isSelected ? 'bg-cyan-700 text-cyan-100' : 'bg-gray-100 text-gray-400'
                                                    }`}>
                                                        غير مرتبط بالتليكرام
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {isLinked && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleSendSingleStudentTelegram(student);
                                                    }}
                                                    title="إرسال إشعار تليكرام فوري للطالب"
                                                    className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                                                        isSelected ? 'bg-cyan-700 text-white border-cyan-500 hover:bg-cyan-800' : 'text-cyan-600 hover:bg-cyan-100 border-cyan-200'
                                                    }`}
                                                >
                                                    <Send size={14} />
                                                </button>
                                            )}

                                            <div className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                                                totalDeducted > 0 
                                                    ? (isSelected ? 'bg-red-500 text-white' : 'bg-red-100 text-red-700')
                                                    : (isSelected ? 'bg-cyan-700 text-cyan-100' : 'bg-emerald-100 text-emerald-800')
                                            }`}>
                                                خصم: {totalDeducted} درجات
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Action Form & Student Deduction History Column */}
                    <div className="lg:col-span-7 space-y-6">
                        {selectedStudentId ? (
                            <div className="space-y-6">
                                <div className="p-5 border border-cyan-200 rounded-2xl shadow-sm bg-gradient-to-br from-blue-50/50 to-cyan-50/30 space-y-4">
                                    <div className="flex items-center justify-between border-b border-cyan-200/80 pb-3">
                                        <div>
                                            <span className="text-xs text-gray-500 font-bold block">خصم وإصدار تنبيه درجات السلوك للـ{studentLabel}:</span>
                                            <h3 className="text-lg font-bold text-cyan-900">
                                                {selectedClass.students.find(s=>s.id === selectedStudentId)?.name}
                                            </h3>
                                        </div>
                                        <div className="text-left">
                                            <span className="text-xs text-gray-500 font-bold block">مجموع الخصم السابق:</span>
                                            <span className="text-sm font-bold text-red-600 bg-red-100 px-3 py-1 rounded-full border border-red-200">
                                                {studentTotals[selectedStudentId] || 0} درجات
                                            </span>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="font-bold text-xs text-gray-700 block mb-1.5">مقدار الخصم:</label>
                                            <div className="flex flex-wrap gap-2">
                                                {[5, 10, 15].map(amount => (
                                                    <button 
                                                        key={amount} 
                                                        type="button"
                                                        onClick={() => setDeductionAmount(amount as 5|10|15)} 
                                                        className={`px-4 py-2 rounded-xl font-bold text-sm transition-all cursor-pointer ${
                                                            deductionAmount === amount 
                                                                ? 'bg-red-600 text-white shadow-md scale-102' 
                                                                : 'bg-white text-gray-700 border hover:bg-gray-50'
                                                        }`}
                                                    >
                                                        خصم {amount} درجات
                                                    </button>
                                                ))}
                                                <button 
                                                    type="button"
                                                    onClick={() => setDeductionAmount(0)} 
                                                    className={`px-4 py-2 rounded-xl font-bold text-sm transition-all cursor-pointer ${
                                                        deductionAmount === 0 
                                                            ? 'bg-amber-500 text-white shadow-md scale-102' 
                                                            : 'bg-white text-gray-700 border hover:bg-gray-50'
                                                    }`}
                                                >
                                                    تنبيه وتوجيه فقط (0)
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <label htmlFor="reason" className="font-bold text-xs text-gray-700 block mb-1.5">
                                                سبب الخصم / التنبيه (سيظهر في الإشعار الموجه للولي والأولياء):
                                            </label>
                                            <textarea 
                                                id="reason" 
                                                value={deductionReason} 
                                                onChange={e => setDeductionReason(e.target.value)} 
                                                rows={3} 
                                                placeholder="أدخل السبب باختصار (مثلاً: مشاغبة في الصف، عدم الالتزام بالزي المدرسي، التأخر عن الحصص...)"
                                                className="w-full p-3 border rounded-xl bg-white focus:ring-2 focus:ring-cyan-500 text-sm" 
                                                required
                                            />
                                        </div>

                                        <div className="flex flex-wrap gap-3 pt-2">
                                            <button 
                                                type="button"
                                                onClick={() => handleDeduct('save_and_notify')} 
                                                disabled={isSubmitting} 
                                                className="flex-1 min-w-[180px] flex justify-center items-center gap-2 py-3 bg-red-600 text-white font-bold rounded-xl shadow-md hover:bg-red-700 disabled:bg-gray-400 transition-all cursor-pointer active:scale-98"
                                            >
                                                {isSubmitting ? <Loader2 className="animate-spin h-5 w-5"/> : <Send size={18}/>}
                                                <span>{deductionAmount > 0 ? 'خصم وإرسال إشعارات التليكرام' : 'تنبيه وإرسال إشعارات التليكرام'}</span>
                                            </button>

                                            <button 
                                                type="button"
                                                onClick={() => handleDeduct('save_only')} 
                                                disabled={isSubmitting} 
                                                className="px-5 py-3 bg-emerald-600 text-white font-bold rounded-xl shadow-md hover:bg-emerald-700 disabled:bg-gray-400 transition-all cursor-pointer active:scale-98 text-sm"
                                            >
                                                <span>حفظ بالنظام فقط</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Student Deduction History List */}
                                <div className="bg-white border rounded-2xl p-5 shadow-sm space-y-3">
                                    <div className="flex items-center gap-2 border-b pb-3">
                                        <History className="text-cyan-600 h-5 w-5" />
                                        <h4 className="font-bold text-gray-800 text-sm">سجل الخصومات والتنبيهات السابقة للطالب</h4>
                                    </div>

                                    {(() => {
                                        const studentDeductions = allDeductions[selectedStudentId] || [];
                                        if (studentDeductions.length === 0) {
                                            return (
                                                <p className="text-center text-gray-400 text-xs py-6">
                                                    لا يوجد أي خصومات أو تنبيهات سابقة مسجلة على هذا الطالب.
                                                </p>
                                            );
                                        }

                                        return (
                                            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                                                {studentDeductions.map(item => (
                                                    <div key={item.id} className="p-3 bg-gray-50 border rounded-xl flex items-start justify-between gap-3 hover:bg-gray-100 transition-colors">
                                                        <div className="space-y-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                                                                    item.pointsDeducted > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                                                                }`}>
                                                                    {item.pointsDeducted > 0 ? `خصم ${item.pointsDeducted} درجات` : 'تنبيه وتوجيه'}
                                                                </span>
                                                                <span className="text-[11px] text-gray-500 font-mono">
                                                                    {new Date(item.timestamp).toLocaleDateString('ar-EG')} - {new Date(item.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-gray-700 font-medium">{item.reason}</p>
                                                        </div>

                                                        <div className="flex items-center gap-1">
                                                            <button 
                                                                type="button"
                                                                onClick={() => {
                                                                    const s = selectedClass.students.find(st => st.id === selectedStudentId);
                                                                    if (s) handleSendSingleStudentTelegram(s, item.reason, item.pointsDeducted);
                                                                }}
                                                                title="إعادة إرسال عبر التليكرام"
                                                                className="p-1.5 text-cyan-600 hover:text-cyan-800 hover:bg-cyan-100 rounded-lg transition-colors cursor-pointer"
                                                            >
                                                                <Send size={14} />
                                                            </button>

                                                            <button 
                                                                type="button"
                                                                onClick={() => handleDeleteDeduction(selectedStudentId, item.id)}
                                                                title="حذف الخصم"
                                                                className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-100 rounded-lg transition-colors cursor-pointer"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center min-h-[300px] bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center space-y-2">
                                <ShieldBan className="h-12 w-12 text-gray-300" />
                                <p className="font-bold text-gray-600 text-sm">حدد طالباً من القائمة للبدء في إجراء خصم الدرجات أو التنبيه</p>
                                <p className="text-xs text-gray-400">يمكنك إرسال إشعارات التليكرام مباشرة لولي الأمر وإلى مجموعة المدرسة عند تسجيل الإجراء.</p>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="text-center text-gray-500 py-12 border-2 border-dashed rounded-2xl bg-gray-50">
                    <ShieldBan className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                    <p className="font-bold text-gray-600">يرجى اختيار مرحلة وشعبة لعرض أسماء الطلاب وإدارة سلوكهم.</p>
                </div>
            )}

            {/* Telegram Log Result Modal */}
            {telegramLogModal && telegramLogModal.open && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-gray-200">
                        <div className="bg-cyan-700 text-white p-4 flex justify-between items-center">
                            <div className="flex items-center gap-2 font-bold text-lg">
                                <Send size={20} />
                                <span>{telegramLogModal.title}</span>
                            </div>
                            <button 
                                onClick={() => setTelegramLogModal(null)}
                                className="p-1 hover:bg-cyan-800 rounded-full transition-colors cursor-pointer"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-5 max-h-[60vh] overflow-y-auto space-y-2 text-sm">
                            {telegramLogModal.logs.map((log, index) => (
                                <div 
                                    key={index} 
                                    className={`p-2.5 rounded-lg border font-medium text-right ${
                                        log.startsWith('✅') ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                                        log.startsWith('❌') ? 'bg-rose-50 text-rose-800 border-rose-200' :
                                        log.startsWith('⚠️') ? 'bg-amber-50 text-amber-800 border-amber-200' :
                                        log.startsWith('---') ? 'font-bold text-cyan-800 border-transparent pt-3 pb-1 text-center' :
                                        'bg-gray-50 text-gray-700 border-gray-200'
                                    }`}
                                >
                                    {log}
                                </div>
                            ))}
                        </div>

                        <div className="bg-gray-100 p-4 text-center border-t">
                            <button 
                                onClick={() => setTelegramLogModal(null)}
                                className="px-6 py-2 bg-cyan-700 text-white font-bold rounded-xl hover:bg-cyan-800 transition-colors cursor-pointer"
                            >
                                إغلاق
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
