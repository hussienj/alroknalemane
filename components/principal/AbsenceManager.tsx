import React, { useState, useEffect, useMemo } from 'react';
import * as ReactDOM from 'react-dom/client';
import type { User, SchoolSettings, ClassData, Student, AbsenceStatus } from '../../types.ts';
import { db } from '../../lib/firebase.ts';
import { Calendar, ListChecks, Printer, AlertTriangle, Loader2, PlayCircle, X, Send, CheckCircle2, MessageSquare, Bot, Users, Bell, Info } from 'lucide-react';
import MonthlyAbsenceReportPDF from './MonthlyAbsenceReportPDF.tsx';
import AbsenceWarningLetterPDF from './AbsenceWarningLetterPDF.tsx';
import { sendTelegramNotification, TelegramConfig } from '../../lib/telegram.ts';

declare const jspdf: any;
declare const html2canvas: any;

interface AbsenceManagerProps {
    principal: User;
    settings: SchoolSettings;
    classes: ClassData[];
}

const STATUS_CYCLE: AbsenceStatus[] = ['present', 'absent', 'excused', 'runaway'];
const STATUS_INFO: Record<AbsenceStatus, { text: string; color: string }> = {
    present: { text: 'حاضر', color: 'bg-green-500' },
    absent: { text: 'غائب', color: 'bg-red-500' },
    excused: { text: 'مجاز', color: 'bg-yellow-500' },
    runaway: { text: 'هارب', color: 'bg-blue-500' },
};

export default function AbsenceManager({ principal, settings, classes }: AbsenceManagerProps) {
    const [activeTab, setActiveTab] = useState<'daily' | 'monthly'>('daily');
    const [selectedClassId, setSelectedClassId] = useState<string>('');
    
    // Daily state
    const [currentDate, setCurrentDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [dailyAbsences, setDailyAbsences] = useState<Record<string, AbsenceStatus>>({});
    const [isLoadingDaily, setIsLoadingDaily] = useState(false);

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

    // Monthly state
    const [currentMonth, setCurrentMonth] = useState(() => new Date().toISOString().slice(0, 7));
    const [monthlyAbsences, setMonthlyAbsences] = useState<Record<string, Record<string, AbsenceStatus>>>({});
    const [isLoadingMonthly, setIsLoadingMonthly] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    
    const [studentForLetter, setStudentForLetter] = useState<Student | null>(null);
    const [isTutorialVisible, setIsTutorialVisible] = useState(false);


    const selectedClass = useMemo(() => classes.find(c => c.id === selectedClassId), [classes, selectedClassId]);
    const sortedStudents = useMemo(() => 
        [...(selectedClass?.students || [])].sort((a, b) => a.name.localeCompare(b.name, 'ar-IQ')),
    [selectedClass]);

    // Create a stable key from student IDs to use as a dependency, preventing re-renders from parent components.
    const studentIdsKey = useMemo(() => (sortedStudents || []).map(s => s.id).join(','), [sortedStudents]);
    
    // Effect for daily data
    useEffect(() => {
        if (!selectedClassId || !currentDate) {
            setDailyAbsences({});
            return;
        }
        setIsLoadingDaily(true);
        const [year, month, day] = currentDate.split('-');
        const path = `absences/${principal.id}/${selectedClassId}/${year}-${month}/${day}`;
        db.ref(path).get().then(snapshot => {
            const data = snapshot.val() || {};
            const initialAbsences: Record<string, AbsenceStatus> = {};
            sortedStudents.forEach(student => {
                initialAbsences[student.id] = data[student.id] || 'present';
            });
            setDailyAbsences(initialAbsences);
        }).finally(() => setIsLoadingDaily(false));
    // The `sortedStudents` array is intentionally omitted from the dependency array.
    // `studentIdsKey` serves as a stable, primitive representation of the student list.
    // This prevents an infinite re-render loop if the parent component passes an unstable `classes` prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedClassId, currentDate, principal.id, studentIdsKey]); 

    // Effect for monthly data
    useEffect(() => {
        if (activeTab !== 'monthly' || !selectedClassId || !currentMonth) {
            setMonthlyAbsences({});
            return;
        }
        setIsLoadingMonthly(true);
        const path = `absences/${principal.id}/${selectedClassId}/${currentMonth}`;
        db.ref(path).get().then(snapshot => {
            setMonthlyAbsences(snapshot.val() || {});
        }).finally(() => setIsLoadingMonthly(false));
    }, [activeTab, selectedClassId, currentMonth, principal.id]);
    
    const handleStatusChange = (studentId: string) => {
        const currentStatus = dailyAbsences[studentId] || 'present';
        const currentIndex = STATUS_CYCLE.indexOf(currentStatus);
        const nextIndex = (currentIndex + 1) % STATUS_CYCLE.length;
        setDailyAbsences(prev => ({ ...prev, [studentId]: STATUS_CYCLE[nextIndex] }));
    };

    const handleSaveDaily = () => {
        if (!selectedClassId || !currentDate) return;
        const [year, month, day] = currentDate.split('-');
        const path = `absences/${principal.id}/${selectedClassId}/${year}-${month}/${day}`;
        db.ref(path).set(dailyAbsences).then(() => {
            alert('تم حفظ الغيابات بنجاح.');
        });
    };

    const handleExecuteAbsenceSaveAndTelegram = async (mode: 'save_only' | 'save_and_notify' | 'notify_individual_only' | 'notify_group_only') => {
        if (!selectedClassId || !currentDate || !selectedClass) return;

        const logs: string[] = [];
        const [year, month, day] = currentDate.split('-');
        const path = `absences/${principal.id}/${selectedClassId}/${year}-${month}/${day}`;

        // Save to DB if requested
        if (mode === 'save_only' || mode === 'save_and_notify') {
            await db.ref(path).set(dailyAbsences);
            logs.push(`✅ تم حفظ سجل الغيابات في النظام بنجاح بتاريخ (${currentDate}).`);
        }

        if (mode === 'save_only') {
            setTelegramLogModal({
                open: true,
                title: 'حفظ الغيابات',
                logs
            });
            return;
        }

        // Get non-present students
        const nonPresentList = sortedStudents
            .map(s => ({ student: s, status: dailyAbsences[s.id] || 'present' }))
            .filter(item => item.status !== 'present');

        if (nonPresentList.length === 0) {
            logs.push('ℹ️ جميع الطلاب حاضرون في هذا التاريخ، لا يوجد غيابات لإرسال إشعارات عنها.');
            setTelegramLogModal({
                open: true,
                title: 'تقرير إرسال التليكرام',
                logs
            });
            return;
        }

        if (!settings?.telegramBotToken?.trim()) {
            logs.push('❌ لم يتم إدخال توكن بوت التليكرام في إعدادات النظام. يرجى التوجه إلى صفحة (الإعدادات) وإدخال رمز البوت (Bot Token) لتفعيل الخدمة.');
            setTelegramLogModal({
                open: true,
                title: 'تنبيه إعدادات التليكرام',
                logs
            });
            return;
        }

        setIsSendingTelegram(true);

        const shouldSendIndividual = (mode === 'save_and_notify' && sendIndividualTelegram) || mode === 'notify_individual_only';
        const shouldSendGroup = (mode === 'save_and_notify' && sendGroupTelegram) || mode === 'notify_group_only';

        // 1. Send Individual Telegram Messages
        if (shouldSendIndividual) {
            logs.push('--- 📱 بدء إرسال الإشعارات الفردية للطلاب غير الحاضرين ---');
            let successCount = 0;
            let missingIdCount = 0;
            let failCount = 0;

            for (const item of nonPresentList) {
                const { student, status } = item;
                const statusName = STATUS_INFO[status]?.text || 'غائب';
                const chatId = student.telegramChatId?.trim();

                // Store in-app notification in Firebase
                try {
                    await db.ref(`student_notifications/${principal.id}/${student.id}`).push({
                        title: `تنبيه غياب يومي (${statusName})`,
                        message: `تم تسجيل حالة (${statusName}) بتاريخ ${currentDate} للشعبة (${selectedClass.stage} - ${selectedClass.section}).`,
                        timestamp: new Date().toISOString(),
                        read: false,
                        type: 'absence_alert'
                    });
                } catch (err) {
                    console.error('Error pushing in-app notification:', err);
                }

                if (!chatId) {
                    missingIdCount++;
                    logs.push(`⚠️ الطالب/ة (${student.name}): لم يقم بربط آيدي التليكرام (Chat ID) بعد.`);
                    continue;
                }

                const msg = 
                    `<b>⚠️ تنبيه غياب طالب</b>\n\n` +
                    `<b>اسم الطالب:</b> ${student.name}\n` +
                    `<b>المرحلة والشعبة:</b> ${selectedClass.stage} - ${selectedClass.section}\n` +
                    `<b>التاريخ:</b> ${currentDate}\n` +
                    `<b>حالة الحضور:</b> ${statusName}\n\n` +
                    `نسترعي انتباه ولي الأمر الموقر لمتابعة سبب غياب الطالب حرصاً على مستواه العلمي والتزامه بالدوام المدرسي.\n\n` +
                    `<i>إدارة المدرسة - معاونية شؤون الطلبة</i>`;

                const res = await sendTelegramNotification(telegramConfig, chatId, msg);
                if (res.success) {
                    successCount++;
                    logs.push(`✅ الطالب/ة (${student.name}): تم إرسال إشعار التليكرام الفردي بنجاح (ID: ${chatId}).`);
                } else {
                    failCount++;
                    logs.push(`❌ الطالب/ة (${student.name}): فشل الإرسال (${res.error})`);
                }
            }

            logs.push(`📊 حصيلة الإرسال الفردي: تم إرسال ${successCount} | ${missingIdCount} غير مرتبطين | ${failCount} فشل.`);
        }

        // 2. Send Group List Telegram Message
        if (shouldSendGroup) {
            logs.push('--- 📢 بدء إرسال قائمة الغيابات الجماعية إلى مجموعة التليكرام ---');
            const targetGroupId = customGroupChatId.trim() || settings?.telegramDefaultChatId?.trim();

            if (!targetGroupId) {
                logs.push('❌ لم يتم تحديد معرف مجموعة التليكرام (Group Chat ID). يرجى أدخال معرف المجموعة في الحقل المخصص.');
            } else {
                const groupMsg = 
                    `<b>📋 قائمة غيابات الطلاب اليومية</b>\n` +
                    `<b>المرحلة والشعبة:</b> ${selectedClass.stage} - ${selectedClass.section}\n` +
                    `<b>التاريخ:</b> ${currentDate}\n` +
                    `<b>العدد الكلي لغير الحاضرين:</b> ${nonPresentList.length} طالب/ة\n` +
                    `-----------------------------------\n` +
                    `<b>أسماء الطلاب الغائبين:</b>\n` +
                    nonPresentList.map((item, idx) => `${idx + 1}. ${item.student.name} (${STATUS_INFO[item.status]?.text || 'غائب'})`).join('\n') +
                    `\n-----------------------------------\n` +
                    `<i>إدارة المدرسة - معاونية شؤون الطلبة</i>`;

                const resGroup = await sendTelegramNotification(telegramConfig, targetGroupId, groupMsg);
                if (resGroup.success) {
                    logs.push(`✅ تم نشر قائمة الغيابات الجماعية لـ (${nonPresentList.length}) طالب بنجاح في المجموعة (${targetGroupId}).`);
                } else {
                    logs.push(`❌ فشل نشر القائمة الجماعية في المجموعة (${targetGroupId}): ${resGroup.error}`);
                }
            }
        }

        setIsSendingTelegram(false);
        setTelegramLogModal({
            open: true,
            title: 'تقرير إشعارات التليكرام والغيابات',
            logs
        });
    };

    const handleSendSingleStudentTelegram = async (student: Student) => {
        if (!selectedClass || !currentDate) return;
        const status = dailyAbsences[student.id] || 'present';
        const statusName = STATUS_INFO[status]?.text || 'غائب';
        const chatId = student.telegramChatId?.trim();

        if (!chatId) {
            alert(`الطالب/ة (${student.name}) لم يقم بربط آيدي التليكرام (Chat ID) بعد. يمكنك إضافة آيدي التليكرام له من صفحة (إدارة تليكرام الطلبة).`);
            return;
        }

        if (!settings?.telegramBotToken?.trim()) {
            alert('لم يتم ضبط توكن بوت التليكرام في إعدادات النظام.');
            return;
        }

        setIsSendingTelegram(true);
        const msg = 
            `<b>⚠️ تنبيه غياب طالب</b>\n\n` +
            `<b>اسم الطالب:</b> ${student.name}\n` +
            `<b>المرحلة والشعبة:</b> ${selectedClass.stage} - ${selectedClass.section}\n` +
            `<b>التاريخ:</b> ${currentDate}\n` +
            `<b>حالة الحضور:</b> ${statusName}\n\n` +
            `نسترعي انتباه ولي الأمر الموقر لمتابعة سبب غياب الطالب حرصاً على مستواه العلمي والتزامه بالدوام المدرسي.\n\n` +
            `<i>إدارة المدرسة - معاونية شؤون الطلبة</i>`;

        const res = await sendTelegramNotification(telegramConfig, chatId, msg);
        setIsSendingTelegram(false);

        if (res.success) {
            alert(`تم إرسال إشعار التليكرام الفردي إلى الطالب (${student.name}) بنجاح!`);
        } else {
            alert(`فشل الإرسال إلى الطالب (${student.name}): ${res.error}`);
        }
    };
    
    const monthlyTotals = useMemo(() => {
        const totals: Record<string, number> = {};
        sortedStudents.forEach(student => {
            let absentCount = 0;
            const studentMonthlyData = monthlyAbsences;
            Object.values(studentMonthlyData).forEach(dailyData => {
                if(dailyData[student.id] === 'absent') {
                    absentCount++;
                }
            });
            totals[student.id] = absentCount;
        });
        return totals;
    }, [monthlyAbsences, sortedStudents]);

    const handleExport = async (type: 'report' | 'letter', student?: Student) => {
        setIsExporting(true);

        const tempContainer = document.createElement('div');
        Object.assign(tempContainer.style, { position: 'absolute', left: '-9999px', top: '0' });
        document.body.appendChild(tempContainer);
        const root = ReactDOM.createRoot(tempContainer);

        const renderComponent = (component: React.ReactElement) => new Promise<void>(resolve => {
            root.render(component);
            setTimeout(resolve, 500);
        });

        try {
            await document.fonts.ready;
            const { jsPDF } = jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            
            if (type === 'report' && selectedClass) {
                await renderComponent(
                    <MonthlyAbsenceReportPDF
                        settings={settings}
                        classData={selectedClass}
                        students={sortedStudents}
                        monthlyAbsences={monthlyAbsences}
                        monthlyTotals={monthlyTotals}
                        month={currentMonth}
                    />
                );
            } else if (type === 'letter' && student && selectedClass) {
                await renderComponent(
                    <AbsenceWarningLetterPDF
                        settings={settings}
                        classData={selectedClass}
                        student={student}
                        totalAbsences={monthlyTotals[student.id] || 0}
                    />
                );
            } else {
                throw new Error("Invalid export configuration.");
            }
            
            const element = tempContainer.children[0] as HTMLElement;
            const canvas = await html2canvas(element, { scale: 2, useCORS: true });
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), undefined, 'FAST');
            pdf.save(`${type}-${selectedClass.stage}-${selectedClass.section}.pdf`);

        } catch (error) {
            console.error(error);
        } finally {
            root.unmount();
            document.body.removeChild(tempContainer);
            setIsExporting(false);
            setStudentForLetter(null);
        }
    };


    return (
        <div className="bg-white p-8 rounded-xl shadow-lg">
            {isExporting && <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"><Loader2 className="text-white h-16 w-16 animate-spin"/></div>}
            
            {isTutorialVisible && (
                <div 
                    className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4"
                    onClick={() => setIsTutorialVisible(false)}
                >
                    <div 
                        className="bg-black p-2 rounded-lg shadow-xl w-full max-w-4xl relative"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button 
                            onClick={() => setIsTutorialVisible(false)}
                            className="absolute -top-3 -right-3 bg-white text-black rounded-full p-2 z-10 shadow-lg hover:scale-110 transition-transform"
                            aria-label="Close video"
                        >
                            <X size={24} />
                        </button>
                        <div className="relative w-full" style={{ paddingTop: '56.25%' }}> {/* 16:9 Aspect Ratio */}
                            <iframe 
                                className="absolute top-0 left-0 w-full h-full"
                                src="https://www.youtube.com/embed/B6z29TlF9hE?autoplay=1"
                                title="شرح طريقة ادارة الغيابات" 
                                frameBorder="0" 
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                                allowFullScreen
                            ></iframe>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex justify-between items-center mb-4 border-b pb-4">
                <h2 className="text-3xl font-bold text-gray-800">إدارة الغيابات</h2>
                 <button
                    onClick={() => setIsTutorialVisible(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-transform transform hover:scale-105"
                >
                    <PlayCircle size={20} />
                    شاهد العرض التوضيحي لطريقة ادارة الغيابات
                </button>
            </div>


            <div className="flex border-b mb-4">
                <button onClick={() => setActiveTab('daily')} className={`px-4 py-2 font-semibold ${activeTab === 'daily' ? 'border-b-2 border-cyan-500 text-cyan-600' : 'text-gray-500'}`}>تسجيل الغياب اليومي</button>
                <button onClick={() => setActiveTab('monthly')} className={`px-4 py-2 font-semibold ${activeTab === 'monthly' ? 'border-b-2 border-cyan-500 text-cyan-600' : 'text-gray-500'}`}>التقرير الشهري</button>
            </div>
            
            <div className="mb-4">
                <label className="font-bold">اختر الشعبة:</label>
                <select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)} className="w-full md:w-1/2 mt-1 p-2 border rounded-md">
                    <option value="">-- اختر شعبة --</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.stage} - {c.section}</option>)}
                </select>
            </div>

            {!selectedClassId && <p className="text-center text-gray-500 p-8">يرجى اختيار شعبة للبدء.</p>}

            {selectedClassId && activeTab === 'daily' && (
                <div>
                    <div className="flex flex-wrap items-center justify-between gap-4 mb-4 bg-gray-50 p-4 rounded-xl border">
                        <div className="flex items-center gap-3">
                            <label className="font-bold text-gray-700">تاريخ الغياب:</label>
                            <input 
                                type="date" 
                                value={currentDate} 
                                onChange={e => setCurrentDate(e.target.value)} 
                                className="p-2 border rounded-lg bg-white shadow-sm font-semibold focus:ring-2 focus:ring-cyan-500"
                            />
                        </div>

                        <div className="flex items-center gap-2 text-sm text-gray-600">
                            <span className="font-bold">المرحلة والشعبة:</span>
                            <span className="bg-cyan-100 text-cyan-800 px-3 py-1 rounded-full font-bold">
                                {selectedClass?.stage} - {selectedClass?.section}
                            </span>
                            <span className="font-bold mr-2">عدد الطلاب:</span>
                            <span className="bg-gray-200 text-gray-800 px-2 py-1 rounded-md font-bold">
                                {sortedStudents.length}
                            </span>
                        </div>
                    </div>

                    {isLoadingDaily ? (
                        <div className="text-center py-12">
                            <Loader2 className="animate-spin mx-auto text-cyan-600 h-10 w-10 mb-2"/>
                            <p className="text-gray-500 font-semibold">جاري تحميل سجل الغيابات...</p>
                        </div>
                    ) : (
                        <div className="space-y-6 max-w-3xl mx-auto">
                            <div className="bg-white border rounded-xl shadow-sm divide-y overflow-hidden">
                                <div className="bg-gray-100 px-4 py-3 flex justify-between items-center text-xs font-bold text-gray-600 uppercase">
                                    <span>اسم الطالب ومعرف التليكرام</span>
                                    <span>حالة الدوام وإرسال سريع</span>
                                </div>

                                {sortedStudents.map(student => {
                                    const status = dailyAbsences[student.id] || 'present';
                                    const isLinked = !!student.telegramChatId && student.telegramChatId.trim() !== '';
                                    return (
                                        <div key={student.id} className="flex items-center justify-between p-3 hover:bg-gray-50 transition-colors">
                                            <div className="flex flex-col">
                                                <span className="font-bold text-gray-800">{student.name}</span>
                                                <div className="flex items-center gap-1 mt-0.5">
                                                    {isLinked ? (
                                                        <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1 font-mono">
                                                            <Send size={10} className="text-emerald-600" />
                                                            آيدي: {student.telegramChatId}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                                                            غير مرتبط بالتليكرام
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                {status !== 'present' && isLinked && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSendSingleStudentTelegram(student)}
                                                        disabled={isSendingTelegram}
                                                        title="إرسال إشعار تليكرام فردي فوري لهذا الطالب"
                                                        className="p-1.5 text-cyan-600 hover:text-cyan-800 hover:bg-cyan-50 rounded-lg transition-colors border border-cyan-200 cursor-pointer"
                                                    >
                                                        <Send size={16} />
                                                    </button>
                                                )}

                                                <button 
                                                    onClick={() => handleStatusChange(student.id)} 
                                                    className={`w-24 text-center py-1.5 text-white rounded-lg text-sm font-bold shadow-sm transition-transform active:scale-95 ${STATUS_INFO[status].color}`}
                                                >
                                                    {STATUS_INFO[status].text}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Telegram Control Panel */}
                            <div className="bg-gradient-to-br from-slate-50 to-cyan-50/50 p-5 rounded-2xl border border-cyan-200/80 shadow-sm space-y-4">
                                <div className="flex items-center justify-between border-b border-cyan-200/60 pb-3">
                                    <div className="flex items-center gap-2">
                                        <Send className="text-cyan-600 h-5 w-5" />
                                        <h3 className="font-bold text-gray-800 text-lg">خيارات وإشعارات التليكرام</h3>
                                    </div>
                                    {settings?.telegramEnabled ? (
                                        <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-3 py-1 rounded-full border border-emerald-300 flex items-center gap-1">
                                            <CheckCircle2 size={13} />
                                            البوت مفعل
                                        </span>
                                    ) : (
                                        <span className="text-xs bg-amber-100 text-amber-800 font-bold px-3 py-1 rounded-full border border-amber-300 flex items-center gap-1">
                                            <AlertTriangle size={13} />
                                            التليكرام غير مفعّل في الإعدادات
                                        </span>
                                    )}
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
                                            <span className="font-bold text-gray-800 text-sm block">إرسال إشعارات فردية للطلاب</span>
                                            <span className="text-xs text-gray-500">إرسال رسالة تليكرام خاصة لكل طالب غائب عبر Chat ID الخاص به</span>
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
                                            <span className="font-bold text-gray-800 text-sm block">إرسال قائمة جماعية لمجموعة التليكرام</span>
                                            <span className="text-xs text-gray-500">نشر قائمة تحتوي على جميع أسماء الغائبين في مجموعة التليكرام</span>
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
                                        <p className="text-[11px] text-gray-500 mt-1">
                                            يمكنك ترك هذا الحقل كما هو لاستخدام معرف المجموعة الافتراضي المكتوب في إعدادات النظام.
                                        </p>
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div className="pt-2 flex flex-wrap gap-3 justify-center">
                                    <button 
                                        onClick={() => handleExecuteAbsenceSaveAndTelegram('save_and_notify')} 
                                        disabled={isSendingTelegram}
                                        className="flex-1 min-w-[200px] px-6 py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50 cursor-pointer"
                                    >
                                        {isSendingTelegram ? <Loader2 className="animate-spin h-5 w-5" /> : <Send size={18} />}
                                        <span>حفظ وإرسال إشعارات التليكرام</span>
                                    </button>

                                    <button 
                                        onClick={() => handleExecuteAbsenceSaveAndTelegram('save_only')} 
                                        disabled={isSendingTelegram}
                                        className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50 cursor-pointer"
                                    >
                                        <span>حفظ في النظام فقط</span>
                                    </button>

                                    <button 
                                        onClick={() => handleExecuteAbsenceSaveAndTelegram('notify_group_only')} 
                                        disabled={isSendingTelegram}
                                        className="px-4 py-3 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50 text-sm cursor-pointer"
                                    >
                                        <Users size={16} />
                                        <span>إرسال القائمة الجماعية للمجموعة</span>
                                    </button>

                                    <button 
                                        onClick={() => handleExecuteAbsenceSaveAndTelegram('notify_individual_only')} 
                                        disabled={isSendingTelegram}
                                        className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50 text-sm cursor-pointer"
                                    >
                                        <Bot size={16} />
                                        <span>إرسال الإشعارات الفردية فقط</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {selectedClassId && activeTab === 'monthly' && (
                <div>
                     <div className="flex items-center gap-4 mb-4">
                        <label className="font-bold">الشهر:</label>
                        <input type="month" value={currentMonth} onChange={e => setCurrentMonth(e.target.value)} className="p-2 border rounded-md"/>
                        <button onClick={() => handleExport('report')} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700"><Printer size={18}/> طباعة التقرير</button>
                    </div>
                     {isLoadingMonthly ? <Loader2 className="animate-spin mx-auto"/> : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full border-collapse border border-gray-400">
                                <thead className="bg-gray-200">
                                    <tr>
                                        <th className="border p-1">اسم الطالب</th>
                                        {Array.from({length: 31}, (_, i) => i + 1).map(day => <th key={day} className="border p-1 w-8">{day}</th>)}
                                        <th className="border p-1">مجموع الغياب</th>
                                        <th className="border p-1">ملاحظات</th>
                                        <th className="border p-1">إجراء</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedStudents.map(student => {
                                        const total = monthlyTotals[student.id] || 0;
                                        let warning = '';
                                        if (total >= 14) warning = 'انذار ثاني';
                                        else if (total >= 7) warning = 'انذار اول';
                                        
                                        return (
                                            <tr key={student.id} className="hover:bg-gray-50">
                                                <td className="border p-1 font-semibold">{student.name}</td>
                                                {Array.from({length: 31}, (_, i) => i + 1).map(day => {
                                                    const dayStr = String(day).padStart(2, '0');
                                                    const status = monthlyAbsences[dayStr]?.[student.id];
                                                    let symbol = '';
                                                    let colorClass = '';
                                                    if (status === 'absent') {
                                                        symbol = 'غ';
                                                        colorClass = 'text-red-600';
                                                    } else if (status === 'excused') {
                                                        symbol = 'م';
                                                        colorClass = 'text-yellow-600';
                                                    } else if (status === 'runaway') {
                                                        symbol = 'هـ';
                                                        colorClass = 'text-blue-600';
                                                    } else if (status === 'present') {
                                                        symbol = 'ح';
                                                        colorClass = 'text-green-600';
                                                    }
                                                    return <td key={day} className={`border p-1 text-center font-bold ${colorClass}`}>{symbol}</td>;
                                                })}
                                                <td className="border p-1 text-center font-bold">{total}</td>
                                                <td className={`border p-1 text-center font-semibold ${total >= 7 ? 'text-red-600' : ''}`}>{warning}</td>
                                                <td className="border p-1 text-center">
                                                    {total > 0 && 
                                                        <button onClick={() => handleExport('letter', student)} className="text-xs bg-red-500 text-white px-2 py-1 rounded">طباعة تبليغ</button>
                                                    }
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                     )}
                </div>
            )}
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