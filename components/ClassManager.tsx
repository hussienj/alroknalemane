
import React, { useState, useRef, useMemo } from 'react';
import type { ClassData, Student, User, TeacherAssignment, Subject } from '../types.ts';
import { GRADE_LEVELS, DEFAULT_SUBJECTS, ensureDefaultSportsAndArtSubjects } from '../constants.ts';
import { Plus, Upload, Trash2, Edit, Save, X, UserPlus, ListVideo, Search, GraduationCap, ArrowLeftRight, Loader2, ShieldCheck } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/firebase.ts';


declare const XLSX: any;

const MINISTERIAL_STAGES = ['الثالث متوسط', 'السادس العلمي', 'السادس الادبي'];

interface ClassManagerProps {
    classes: ClassData[];
    onSelectClass: (classId: string) => void;
    currentUser: User;
    teacherAssignments?: TeacherAssignment[];
}

export default function ClassManager({ classes, onSelectClass, currentUser, teacherAssignments }: ClassManagerProps): React.ReactNode {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingClass, setEditingClass] = useState<Partial<ClassData> | null>(null);
    const [isStudentModalOpen, setIsStudentModalOpen] = useState(false);
    const [selectedClassForStudentAdd, setSelectedClassForStudentAdd] = useState<ClassData | null>(null);
    const [pastedData, setPastedData] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // State for subject editing
    const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
    const [editingSubjectName, setEditingSubjectName] = useState('');
    const [newSubjectName, setNewSubjectName] = useState('');
    
    // State for student transfer
    const [transferStudent, setTransferStudent] = useState<{ student: Student; sourceClass: ClassData } | null>(null);
    const [targetClassId, setTargetClassId] = useState<string>('');
    const [isTransferring, setIsTransferring] = useState<boolean>(false);

    const isPrincipal = currentUser.role === 'principal';

    const targetSections = useMemo(() => {
        if (!transferStudent) return [];
        return classes.filter(c => c.stage === transferStudent.sourceClass.stage && c.id !== transferStudent.sourceClass.id);
    }, [classes, transferStudent]);

    const handleConfirmTransfer = async () => {
        if (!transferStudent || !targetClassId) return;
        const { student, sourceClass } = transferStudent;
        const targetClass = classes.find(c => c.id === targetClassId);
        if (!targetClass) return;

        if (!confirm(`هل أنت متأكد من نقل الطالب (${student.name}) من الشعبة (${sourceClass.section}) إلى الشعبة (${targetClass.section})؟\n\nتنبيه: ستبقى جميع الدرجات والرمز السري والبيانات محفوظة بالكامل.`)) {
            return;
        }

        setIsTransferring(true);
        try {
            const updatedSourceStudents = (sourceClass.students || []).filter(s => s.id !== student.id);
            const existingTargetStudents = targetClass.students || [];
            const filteredTargetStudents = existingTargetStudents.filter(s => s.id !== student.id);
            const updatedTargetStudents = [...filteredTargetStudents, student].sort((a, b) =>
                (a.examId || '').localeCompare(b.examId || '', undefined, { numeric: true })
            );

            const updates: Record<string, any> = {};
            updates[`classes/${sourceClass.id}/students`] = updatedSourceStudents;
            updates[`classes/${targetClass.id}/students`] = updatedTargetStudents;

            if (student.studentAccessCode) {
                updates[`student_access_codes_individual/${student.studentAccessCode}/classId`] = targetClass.id;
            }

            await db.ref().update(updates);

            alert(`تم نقل الطالب (${student.name}) بنجاح إلى الشعبة (${targetClass.section}).`);
            setTransferStudent(null);
            setTargetClassId('');
        } catch (err) {
            console.error("Transfer error:", err);
            alert("حدث خطأ أثناء نقل الطالب.");
        } finally {
            setIsTransferring(false);
        }
    };

    const displayedClasses = useMemo(() => {
        let filteredClasses;
        if (isPrincipal) {
            filteredClasses = classes.filter(c => c.principalId === currentUser.id);
        } else { // For teacher
            const assignedClassIds = teacherAssignments?.map(a => a.classId) || [];
            filteredClasses = classes.filter(c => assignedClassIds.includes(c.id));
        }

        return filteredClasses.sort((a, b) => {
            const stageAIndex = GRADE_LEVELS.indexOf(a.stage);
            const stageBIndex = GRADE_LEVELS.indexOf(b.stage);
            if (stageAIndex === -1 && stageBIndex !== -1) return 1;
            if (stageAIndex !== -1 && stageBIndex === -1) return -1;
            if (stageAIndex !== stageBIndex) return stageAIndex - stageBIndex;
            return a.section.localeCompare(b.section, 'ar-IQ');
        });
    }, [classes, isPrincipal, currentUser.id, teacherAssignments]);

    // Search results calculation
    const searchResults = useMemo(() => {
        if (!searchQuery.trim() || searchQuery.length < 2) return [];
        
        const results: { student: Student, classData: ClassData }[] = [];
        displayedClasses.forEach(cls => {
            (cls.students || []).forEach(student => {
                if (student.name.includes(searchQuery.trim())) {
                    results.push({ student, classData: cls });
                }
            });
        });
        return results;
    }, [searchQuery, displayedClasses]);

    const handleOpenModal = (classToEdit: Partial<ClassData> | null) => {
        if (classToEdit) {
            setEditingClass({
                ...classToEdit,
                subjects: ensureDefaultSportsAndArtSubjects(classToEdit.subjects || []),
            });
        } else {
            const defaultStage = GRADE_LEVELS[6] || GRADE_LEVELS[0];
            setEditingClass({
                id: '',
                stage: defaultStage,
                section: '',
                subjects: ensureDefaultSportsAndArtSubjects(DEFAULT_SUBJECTS[defaultStage] || []),
                students: [],
                principalId: currentUser.id,
            });
        }
        setIsModalOpen(true);
    };

    const handleSaveClass = () => {
        if (!editingClass || !editingClass.stage || !editingClass.section) {
            alert('يرجى تحديد المرحلة والشعبة.');
            return;
        }

        const classToSave: ClassData = {
            id: editingClass.id || uuidv4(),
            stage: editingClass.stage,
            section: editingClass.section,
            subjects: ensureDefaultSportsAndArtSubjects(editingClass.subjects || []),
            students: editingClass.students || [],
            principalId: currentUser.id,
            ...MINISTERIAL_STAGES.includes(editingClass.stage) && {
                ministerialDecisionPoints: editingClass.ministerialDecisionPoints ?? 5,
                ministerialSupplementarySubjects: editingClass.ministerialSupplementarySubjects ?? 2,
            }
        };

        db.ref(`classes/${classToSave.id}`).set(classToSave);
        setIsModalOpen(false);
        setEditingClass(null);
    };

    const handleDeleteClass = (classId: string) => {
        if (window.confirm('هل أنت متأكد من حذف هذه الشعبة وجميع الطلاب فيها؟ لا يمكن التراجع عن هذا الإجراء.')) {
            db.ref(`classes/${classId}`).remove();
        }
    };

    const handleStageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newStage = e.target.value;
        setEditingClass(prev => ({
            ...prev,
            stage: newStage,
            subjects: ensureDefaultSportsAndArtSubjects(DEFAULT_SUBJECTS[newStage] || []),
        }));
    };
    
    const handleAddStudentFromFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !selectedClassForStudentAdd) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            if (typeof XLSX === 'undefined') {
                alert('مكتبة معالجة ملفات Excel غير متاحة. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.');
                setIsStudentModalOpen(false);
                return;
            }

            try {
                if (!event.target?.result) throw new Error("فشل قراءة الملف.");
                const data = new Uint8Array(event.target.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                if (json.length <= 1) throw new Error("الملف فارغ أو لا يحتوي على بيانات طلاب.");

                const newStudents: Student[] = json
                    .slice(1)
                    .map((row: any[]) => ({
                        id: uuidv4(),
                        name: row[0] ? String(row[0]).trim() : '',
                        examId: row[1] ? String(row[1]).trim() : '',
                        registrationId: row[2] ? String(row[2]).trim() : '',
                        birthDate: row[3] ? String(row[3]).trim() : '',
                        yearsOfFailure: row[4] ? String(row[4]).trim() : 'لا يوجد رسوب',
                        grades: {},
                    }))
                    .filter(student => student.name);

                if (newStudents.length > 0) {
                    const updatedStudents = [...(selectedClassForStudentAdd.students || []), ...newStudents];
                    db.ref(`classes/${selectedClassForStudentAdd.id}/students`).set(updatedStudents);
                    alert(`تمت إضافة ${newStudents.length} طالب بنجاح.`);
                    setIsStudentModalOpen(false);
                } else {
                    throw new Error("لم يتم العثور على أسماء طلاب صالحة في الملف.");
                }
            } catch (error) {
                console.error("Error processing Excel file:", error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                alert(`حدث خطأ أثناء معالجة ملف Excel. التفاصيل: ${errorMessage}`);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const handleAddStudentFromPaste = () => {
        if (!pastedData || !selectedClassForStudentAdd) return;
        try {
            const rows = pastedData.split('\n').filter(row => row.trim() !== '');
            const newStudents: Student[] = rows.map(row => {
                const columns = row.split('\t');
                return {
                    id: uuidv4(),
                    name: columns[0] ? columns[0].trim() : '',
                    examId: columns[1] ? columns[1].trim() : '',
                    registrationId: columns[2] ? columns[2].trim() : '',
                    birthDate: columns[3] ? columns[3].trim() : '',
                    yearsOfFailure: columns[4] ? columns[4].trim() : 'لا يوجد رسوب',
                    grades: {},
                };
            }).filter(student => student.name);

            if (newStudents.length > 0) {
                const updatedStudents = [...(selectedClassForStudentAdd.students || []), ...newStudents];
                db.ref(`classes/${selectedClassForStudentAdd.id}/students`).set(updatedStudents);
                alert(`تمت إضافة ${newStudents.length} طالب بنجاح.`);
                setIsStudentModalOpen(false);
                setPastedData('');
            } else {
                alert("لم يتم العثور على بيانات طلاب صالحة في النص الملصق.");
            }
        } catch (error) {
            console.error("Error processing pasted data:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            alert(`حدث خطأ أثناء معالجة البيانات الملصقة. التفاصيل: ${errorMessage}`);
        }
    };
    
    const handleSubjectNameChange = () => {
        if (!editingClass || !editingSubjectId || !editingSubjectName.trim()) return;
        const newSubjects = (editingClass.subjects || []).map(s => 
            s.id === editingSubjectId ? { ...s, name: editingSubjectName.trim() } : s
        );
        setEditingClass(prev => ({...prev, subjects: newSubjects}));
        setEditingSubjectId(null);
        setEditingSubjectName('');
    };

    const handleAddSubject = () => {
        if (!editingClass || !newSubjectName.trim()) return;
        const newSubject: Subject = { id: uuidv4(), name: newSubjectName.trim() };
        const newSubjects = [...(editingClass.subjects || []), newSubject];
        setEditingClass(prev => ({...prev, subjects: newSubjects}));
        setNewSubjectName('');
    };
    
    const handleDeleteSubject = (subjectIdToDelete: string) => {
         if (!editingClass) return;
         const newSubjects = (editingClass.subjects || []).filter(s => s.id !== subjectIdToDelete);
         setEditingClass(prev => ({...prev, subjects: newSubjects}));
    };
    
    const renderModal = () => {
        if (!isModalOpen) return null;
        const isMinisterial = editingClass?.stage ? MINISTERIAL_STAGES.includes(editingClass.stage) : false;

        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
                <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col">
                    <h3 className="text-xl font-bold mb-4">{editingClass?.id ? 'تعديل الشعبة' : 'إضافة شعبة جديدة'}</h3>
                    <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                             <div>
                                <label className="block text-sm font-medium text-gray-700">المرحلة الدراسية</label>
                                <select
                                    value={editingClass?.stage || ''}
                                    onChange={handleStageChange}
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm bg-white disabled:bg-gray-200"
                                    disabled={!!editingClass?.id}
                                >
                                    {GRADE_LEVELS.map(level => (
                                        <option key={level} value={level}>{level}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">اسم الشعبة</label>
                                <input
                                    type="text"
                                    value={editingClass?.section || ''}
                                    onChange={(e) => setEditingClass(prev => ({ ...prev, section: e.target.value }))}
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                                />
                            </div>
                        </div>

                        {isMinisterial && (
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                                 <div>
                                    <label className="block text-sm font-medium text-gray-700">درجات القرار الوزاري</label>
                                    <input
                                        type="number"
                                        value={editingClass?.ministerialDecisionPoints ?? 5}
                                        onChange={(e) => setEditingClass(prev => ({ ...prev, ministerialDecisionPoints: parseInt(e.target.value) }))}
                                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">عدد مواد الاكمال الوزاري</label>
                                    <input
                                        type="number"
                                        value={editingClass?.ministerialSupplementarySubjects ?? 2}
                                        onChange={(e) => setEditingClass(prev => ({ ...prev, ministerialSupplementarySubjects: parseInt(e.target.value) }))}
                                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                                    />
                                </div>
                            </div>
                        )}
                        
                        <div className="mt-4">
                            <h4 className="font-semibold mb-2">المواد الدراسية</h4>
                            <div className="space-y-2 max-h-60 overflow-y-auto border p-2 rounded-md">
                                {(editingClass?.subjects || []).map(subject => (
                                    <div key={subject.id} className="flex items-center gap-2 p-1 bg-gray-100 rounded">
                                        {editingSubjectId === subject.id ? (
                                            <>
                                                <input value={editingSubjectName} onChange={e => setEditingSubjectName(e.target.value)} className="flex-grow p-1 border rounded" autoFocus onBlur={handleSubjectNameChange} onKeyDown={e => e.key === 'Enter' && handleSubjectNameChange()}/>
                                                <button onClick={handleSubjectNameChange}><Save size={18} className="text-green-600"/></button>
                                            </>
                                        ) : (
                                            <>
                                                <span className="flex-grow">{subject.name}</span>
                                                <button onClick={() => { setEditingSubjectId(subject.id); setEditingSubjectName(subject.name); }}><Edit size={18} className="text-yellow-600"/></button>
                                                <button onClick={() => handleDeleteSubject(subject.id)}><Trash2 size={18} className="text-red-600"/></button>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                             <div className="flex items-center gap-2 mt-2">
                                <input value={newSubjectName} onChange={e => setNewSubjectName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddSubject()} placeholder="إضافة مادة جديدة" className="flex-grow p-2 border rounded"/>
                                <button onClick={handleAddSubject} className="p-2 bg-blue-500 text-white rounded"><Plus/></button>
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
                        <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md flex items-center gap-2"><X size={18} /> إلغاء</button>
                        <button onClick={handleSaveClass} className="px-4 py-2 bg-green-600 text-white rounded-md flex items-center gap-2"><Save size={18} /> حفظ</button>
                    </div>
                </div>
            </div>
        );
    };

    const renderStudentModal = () => {
        if (!isStudentModalOpen) return null;
        return (
             <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
                <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg">
                    <h3 className="text-xl font-bold mb-4">إضافة طلاب إلى {selectedClassForStudentAdd?.stage} / {selectedClassForStudentAdd?.section}</h3>
                    <div className="space-y-4">
                         <div className="p-4 border rounded-lg">
                             <h4 className="font-semibold mb-2">1. إضافة من ملف Excel</h4>
                             <p className="text-sm text-gray-500 mb-2">يجب أن يحتوي الملف على الأعمدة التالية بالترتيب: الاسم، الرقم الامتحاني، رقم القيد، التولد، سنوات الرسوب.</p>
                             <input type="file" ref={fileInputRef} onChange={handleAddStudentFromFile} accept=".xlsx, .xls" className="hidden" />
                             <button onClick={() => fileInputRef.current?.click()} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">
                                 <Upload size={18} />
                                 <span>اختر ملف</span>
                             </button>
                         </div>
                         <div className="p-4 border rounded-lg">
                             <h4 className="font-semibold mb-2">2. لصق البيانات من جدول</h4>
                             <p className="text-sm text-gray-500 mb-2">انسخ البيانات من Excel والصقها هنا. تأكد من نفس ترتيب الأعمدة المذكور أعلاه.</p>
                             <textarea value={pastedData} onChange={(e) => setPastedData(e.target.value)} rows={5} className="w-full p-2 border rounded" placeholder="الصق بيانات الطلاب هنا..."></textarea>
                             <button onClick={handleAddStudentFromPaste} className="w-full mt-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                                 إضافة من النص
                             </button>
                         </div>
                    </div>
                    <div className="mt-6 flex justify-end">
                        <button onClick={() => setIsStudentModalOpen(false)} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md">إغلاق</button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 sm:p-0">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-800">إدارة الشعب الدراسية</h2>
                
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                    {/* Search Field */}
                    <div className="relative flex-grow min-w-[250px]">
                        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                            <Search className="h-5 w-5 text-gray-400" />
                        </div>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="block w-full pr-10 pl-3 py-2 border border-gray-300 rounded-lg focus:ring-cyan-500 focus:border-cyan-500 bg-white"
                            placeholder="ابحث عن طالب بالاسم..."
                        />
                        {searchQuery && (
                            <button 
                                onClick={() => setSearchQuery('')}
                                className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400 hover:text-gray-600"
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>

                    {isPrincipal && (
                        <button onClick={() => handleOpenModal(null)} className="flex items-center justify-center gap-2 px-4 py-2 bg-cyan-600 text-white font-bold rounded-lg hover:bg-cyan-700 transition-colors shadow-md">
                            <Plus size={20} />
                            <span className="whitespace-nowrap">إضافة شعبة</span>
                        </button>
                    )}
                </div>
            </div>

            {searchQuery.trim() !== '' ? (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                         <h3 className="text-lg font-bold text-gray-700 flex items-center gap-2">
                            <GraduationCap size={20}/> نتائج البحث عن: <span className="text-cyan-600">"{searchQuery}"</span>
                        </h3>
                        <span className="text-sm text-gray-500">{searchResults.length} نتيجة</span>
                    </div>
                    {searchResults.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {searchResults.map(({ student, classData }) => (
                                <div key={student.id} className="bg-white p-4 rounded-lg shadow-md border-r-4 border-yellow-500 hover:shadow-lg transition-shadow">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h4 className="font-bold text-gray-800 text-lg">{student.name}</h4>
                                            <p className="text-sm text-cyan-600 font-semibold">{classData.stage} - {classData.section}</p>
                                            {student.examId && <p className="text-xs text-gray-400 mt-1">الرقم الامتحاني: {student.examId}</p>}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button 
                                                onClick={() => { setTransferStudent({ student, sourceClass: classData }); setTargetClassId(''); }}
                                                className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
                                                title="نقل الطالب إلى شعبة أخرى في نفس المرحلة"
                                            >
                                                <ArrowLeftRight size={20} />
                                            </button>
                                            <button 
                                                onClick={() => onSelectClass(classData.id)}
                                                className="p-2 text-cyan-600 hover:bg-cyan-50 rounded-full transition-colors"
                                                title="عرض سجل درجات الشعبة"
                                            >
                                                <ListVideo size={20} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center p-12 bg-white rounded-lg shadow-inner">
                            <Search className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                            <p className="text-gray-500 text-lg">لم يتم العثور على أي طالب بهذا الاسم.</p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {displayedClasses.map(cls => (
                        <div key={cls.id} className="bg-white p-4 rounded-lg shadow-md border-r-4 border-cyan-500 hover:shadow-lg transition-all">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                                <div>
                                    <h3 className="text-xl font-bold text-gray-800">{cls.stage} - {cls.section}</h3>
                                    <p className="text-sm text-gray-500">{(cls.students || []).length} طالب</p>
                                </div>
                                <div className="flex items-center gap-2 mt-2 sm:mt-0 flex-shrink-0">
                                    {isPrincipal && (
                                        <>
                                            <button onClick={() => { setSelectedClassForStudentAdd(cls); setIsStudentModalOpen(true); }} className="p-2 text-white bg-green-500 rounded-md hover:bg-green-600 transition" title="إضافة طلاب"><UserPlus size={18}/></button>
                                            <button onClick={() => handleOpenModal(cls)} className="p-2 text-white bg-yellow-500 rounded-md hover:bg-yellow-600 transition" title="تعديل"><Edit size={18}/></button>
                                            <button onClick={() => handleDeleteClass(cls.id)} className="p-2 text-white bg-red-500 rounded-md hover:bg-red-600 transition" title="حذف"><Trash2 size={18}/></button>
                                        </>
                                    )}
                                    <button onClick={() => onSelectClass(cls.id)} className="p-2 text-white bg-blue-500 rounded-md hover:bg-blue-600 transition" title="عرض سجل الدرجات"><ListVideo size={18}/></button>
                                </div>
                            </div>
                        </div>
                    ))}
                    {displayedClasses.length === 0 && (
                        <div className="col-span-full text-center p-12 bg-white rounded-lg">
                            <p className="text-gray-500">لا توجد شعب دراسية مضافة حالياً.</p>
                        </div>
                    )}
                </div>
            )}
            
            {renderModal()}
            {renderStudentModal()}
            {transferStudent && (
                <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-[100] p-4">
                    <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-md border border-gray-100">
                        <div className="flex items-center gap-3 text-indigo-700 mb-4 pb-3 border-b">
                            <ArrowLeftRight className="w-6 h-6" />
                            <h3 className="text-xl font-bold">نقل الطالب إلى شعبة أخرى</h3>
                        </div>

                        <div className="space-y-4 mb-6">
                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                                <p className="text-xs text-gray-500 font-bold mb-1">اسم الطالب</p>
                                <p className="font-bold text-gray-800 text-lg">{transferStudent.student.name}</p>
                                {transferStudent.student.examId && (
                                    <p className="text-xs text-indigo-600 mt-1 font-semibold">الرقم الامتحاني: {transferStudent.student.examId}</p>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                                    <p className="text-xs text-blue-600 font-bold">المرحلة الدراسية</p>
                                    <p className="font-bold text-blue-900 mt-0.5">{transferStudent.sourceClass.stage}</p>
                                </div>
                                <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
                                    <p className="text-xs text-amber-700 font-bold">الشعبة الحالية</p>
                                    <p className="font-bold text-amber-900 mt-0.5">{transferStudent.sourceClass.section}</p>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">
                                    اختر الشعبة الجديدة للنقل إليها (في نفس المرحلة)
                                </label>
                                {targetSections.length > 0 ? (
                                    <select
                                        value={targetClassId}
                                        onChange={(e) => setTargetClassId(e.target.value)}
                                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 font-bold text-gray-800"
                                    >
                                        <option value="">-- اختر الشعبة الجديدة --</option>
                                        {targetSections.map(c => (
                                            <option key={c.id} value={c.id}>
                                                الشعبة ({c.section}) - {c.students?.length || 0} طالب
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm font-semibold">
                                        لا توجد شعب أخرى مضافة لمرحلة ({transferStudent.sourceClass.stage}). يرجى إضافة شعبة أخرى أولاً للنقل إليها.
                                    </div>
                                )}
                            </div>

                            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800 flex items-start gap-2">
                                <ShieldCheck className="w-5 h-5 flex-shrink-0 text-green-600 mt-0.5" />
                                <span>
                                    تنبيه: يتم نقل جميع الدرجات والرمز السري والبيانات الشخصية للطالب بالكامل دون أي تعديل أو تغيير.
                                </span>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-3 border-t">
                            <button
                                type="button"
                                onClick={() => { setTransferStudent(null); setTargetClassId(''); }}
                                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg font-bold hover:bg-gray-300 transition"
                                disabled={isTransferring}
                            >
                                إلغاء
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmTransfer}
                                disabled={!targetClassId || isTransferring}
                                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold transition flex items-center gap-2 disabled:bg-gray-400"
                            >
                                {isTransferring ? (
                                    <>
                                        <Loader2 className="animate-spin w-4 h-4" />
                                        <span>جاري النقل...</span>
                                    </>
                                ) : (
                                    <>
                                        <ArrowLeftRight className="w-4 h-4" />
                                        <span>تأكيد نقل الطالب</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
