

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDrag, useDrop, DropTargetMonitor, ConnectDropTarget, ConnectDragSource, ConnectDragPreview } from 'react-dnd';
import { 
    User, Task, StudentContext, AppSettings, QuadrantType, ToastData, 
    ModalState, SubtaskModalData, ItemTypes, DraggableTaskItem,
    RecurringSettings, AIClassificationResponse
} from '../types';
import { ICONS, QUADRANT_CONFIGS, MOOD_OPTIONS, DEFAULT_STUDENT_CONTEXT, DEFAULT_SETTINGS, GEMINI_MODEL_NAME } from '../constants';
import { useIsMobile } from '../hooks/useIsMobile';
import { signOut, saveDataToFirestore, listenToDocument } from '../services/firebaseService';
import { performAIClassification, performAIBreakdown, getAIMoveReasoning, getAIMoodSuggestion } from '../services/geminiService';

interface ApplicationLayoutProps {
  user: User;
  setGlobalError: (message: string | null) => void;
}

// Helper: Generate unique ID for tasks
const generateTaskId = (): string => `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// --- Main Application Component (after login) ---
const ApplicationLayout: React.FC<ApplicationLayoutProps> = ({ user, setGlobalError }) => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [studentContext, setStudentContext] = useState<StudentContext>(DEFAULT_STUDENT_CONTEXT);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  
  const [dataLoading, setDataLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<boolean | string>(false); // string for specific loading states

  const [infoModal, setInfoModal] = useState<ModalState<Task>>({ isOpen: false, data: null });
  const [editModal, setEditModal] = useState<ModalState<Task>>({ isOpen: false, data: null });
  const [subtaskModal, setSubtaskModal] = useState<ModalState<SubtaskModalData>>({ isOpen: false, data: null });
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  
  const [toast, setToast] = useState<ToastData>({ show: false, message: '', type: 'info' });
  
  const [newTaskName, setNewTaskName] = useState('');
  const [newDueDate, setNewDueDate] = useState('');

  const isMobile = useIsMobile();

  const showToast = useCallback((message: string, type: ToastData['type'] = 'success', duration = 3000) => {
    setToast({ show: true, message, type });
    // Timer is handled by ToastNotification component itself
  }, []);

  // Data Fetching
  useEffect(() => {
    if (!user) return;
    setDataLoading(true);

    const unsubscribes: Array<() => void> = [];

    unsubscribes.push(
      listenToDocument<Task[]>(user.uid, 'tasks', (data) => {
        setTasks(Array.isArray(data) ? data : []); 
      }, [] as Task[])
    );

    unsubscribes.push(
      listenToDocument<StudentContext>(user.uid, 'studentContext', (data) => {
        setStudentContext(data || DEFAULT_STUDENT_CONTEXT);
      }, DEFAULT_STUDENT_CONTEXT)
    );

    unsubscribes.push(
      listenToDocument<AppSettings>(user.uid, 'settings', (data) => {
        setSettings(data || DEFAULT_SETTINGS);
      }, DEFAULT_SETTINGS)
    );
    
    const loadingTimer = setTimeout(() => {
        setDataLoading(false); 
    }, 250); 

    unsubscribes.push(() => clearTimeout(loadingTimer));
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => unsubscribes.forEach(unsub => unsub());
  }, [user.uid]);


  // Data Saving
  const saveData = useCallback(async <T,>(collectionName: string, data: T, successMessage?: string) => {
    if (!user) {
        const noUserError = new Error("User not authenticated. Cannot save data.");
        setGlobalError(noUserError.message);
        throw noUserError;
    }
    try {
      await saveDataToFirestore(user.uid, collectionName, data); // from firebaseService.ts
      if (successMessage) showToast(successMessage);
    } catch (err: any) { 
        console.error(`Error saving ${collectionName} for user ${user.uid}:`, err); 
        const errorMessage = err.message?.includes("invalid data") 
            ? `Failed to save ${collectionName}: An error occurred with the data format.` 
            : `Failed to save ${collectionName}. Backend error: ${err.message || 'Unknown error'}`;
        setGlobalError(errorMessage);
        throw err; // Re-throw the error so the caller can handle it
    }
  }, [user, showToast, setGlobalError]);

  // Update tasks state and save to Firestore
  const updateTasks = useCallback((newTasks: Task[], successMessage?: string) => {
    setTasks(newTasks);
    saveData('tasks', newTasks, successMessage).catch(error => {
      // Error is already set by saveData, this catch is to prevent unhandled promise rejection
      console.warn("Failed to save tasks after update:", error.message);
    });
  }, [saveData]);
  
  const handleContextUpdate = useCallback((newContext: StudentContext, successMessage?: string) => {
    setStudentContext(newContext);
    saveData('studentContext', newContext, successMessage).catch(error => {
      console.warn("Failed to save context after update:", error.message);
    });
  }, [saveData]);

  // --- Task Management Functions ---
  const handleAddTask = (e: React.FormEvent<HTMLFormElement>) => { 
    e.preventDefault(); 
    if (!newTaskName.trim()) {
        showToast("Task name cannot be empty.", "error");
        return;
    }
    const newTask: Task = { 
        id: generateTaskId(), 
        name: newTaskName.trim(), 
        dueDate: newDueDate, 
        quadrant: 'unclassified', 
        reasoning: 'Not classified yet.', 
        createdAt: new Date().toISOString(), 
        status: 'active', 
        recurring: null, 
        parentId: null 
    }; 
    updateTasks([...tasks, newTask]); 
    setNewTaskName(''); 
    setNewDueDate(''); 
  };
  
  const handleAddSubtasks = (subtaskNames: string[], parentTask: Task) => {
    const newSubtasks: Task[] = subtaskNames.map(name => ({ 
        id: generateTaskId(), 
        name, 
        dueDate: '', 
        quadrant: parentTask.quadrant, 
        reasoning: `Sub-task for "${parentTask.name}".`, 
        createdAt: new Date().toISOString(), 
        status: 'active', 
        recurring: null, 
        parentId: parentTask.id 
    }));
    updateTasks([...tasks, ...newSubtasks], `${newSubtasks.length} sub-tasks added.`);
    setSubtaskModal({ isOpen: false, data: null });
  };
  
  const getAllDescendantIds = useCallback((taskId: string, allTasks: Task[]): string[] => {
    let descendants: string[] = [];
    const children = allTasks.filter(t => t.parentId === taskId);
    for (const child of children) {
        descendants.push(child.id);
        descendants = [...descendants, ...getAllDescendantIds(child.id, allTasks)];
    }
    return descendants;
  }, []);

  const handleTaskStatusChange = (taskId: string, newStatus: Task['status']) => {
    let tasksToUpdate = [...tasks];
    const task = tasksToUpdate.find(t => t.id === taskId);
    if (!task) return;

    let successMessage = newStatus === 'completed' ? `Task "${task.name}" completed!` : undefined;

    const idsToUpdateStatus = [taskId, ...getAllDescendantIds(taskId, tasksToUpdate)];
    tasksToUpdate = tasksToUpdate.map(t => idsToUpdateStatus.includes(t.id) ? { ...t, status: newStatus } : t);

    const mainTask = tasksToUpdate.find(t => t.id === taskId); 
    if (newStatus === 'completed' && mainTask && mainTask.recurring && mainTask.recurring.type !== 'none') {
        const baseDateStr = mainTask.dueDate || new Date().toISOString().split('T')[0];
        const nextDueDate = new Date(`${baseDateStr}T00:00:00`); 

        switch (mainTask.recurring.type) {
            case 'daily': nextDueDate.setDate(nextDueDate.getDate() + mainTask.recurring.interval); break;
            case 'weekly': nextDueDate.setDate(nextDueDate.getDate() + 7 * mainTask.recurring.interval); break;
            case 'monthly': nextDueDate.setMonth(nextDueDate.getMonth() + mainTask.recurring.interval); break;
        }
        
        const newRecurringTask: Task = { 
            ...mainTask, 
            id: generateTaskId(), 
            dueDate: nextDueDate.toISOString().split('T')[0], 
            status: 'active', 
            quadrant: 'unclassified', 
            reasoning: 'New recurring instance. Needs classification.', 
            createdAt: new Date().toISOString() 
        };
        tasksToUpdate.push(newRecurringTask);
        if (successMessage) successMessage += " Next instance created.";
        else successMessage = "Next recurring instance created.";
    }
    
    updateTasks(tasksToUpdate, successMessage);
  };
  
  const handleRecoverTask = (taskId: string) => {
    const idsToUpdate = [taskId, ...getAllDescendantIds(taskId, tasks)];
    const taskToRecover = tasks.find(t => t.id === taskId);
    updateTasks(
        tasks.map(t => idsToUpdate.includes(t.id) ? { ...t, status: 'active' } : t),
        `Task "${taskToRecover?.name}" recovered.`
    );
  };

  const handlePermanentDelete = (taskId: string) => { 
      const taskToDelete = tasks.find(t => t.id === taskId);
      if (window.confirm(`Permanently delete task "${taskToDelete?.name}" and all its sub-tasks? This action cannot be undone.`)) {
        setActionLoading(`delete-${taskId}`);
        const idsToDelete = [taskId, ...getAllDescendantIds(taskId, tasks)];
        updateTasks(tasks.filter(t => !idsToDelete.includes(t.id)), `Task "${taskToDelete?.name}" permanently deleted.`);
        setActionLoading(false);
      }
  };
  
  const handleEmptyTrash = () => { 
    if (window.confirm("Permanently empty the trash? This action cannot be undone.")) {
        setActionLoading('emptyTrash');
        updateTasks(tasks.filter(t => t.status !== 'trashed'), "Trash emptied.");
        setActionLoading(false);
    }
  };
  
  const handleUpdateTaskDetails = (taskId: string, newName: string, newDueDate: string, newRecurring: RecurringSettings | null) => { 
    const taskToUpdate = tasks.find(t => t.id === taskId);
    updateTasks(
        tasks.map(t => t.id === taskId ? { ...t, name: newName, dueDate: newDueDate, recurring: newRecurring } : t),
        `Task "${taskToUpdate?.name}" updated.`
    ); 
    setEditModal({isOpen: false, data: null}); 
  };
  
  const handleMoveTaskQuadrant = useCallback(async (taskId: string, oldQuadrant: QuadrantType, newQuadrant: QuadrantType) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    updateTasks(tasks.map(t => t.id === taskId ? { ...t, quadrant: newQuadrant, reasoning: `Manually moved from ${QUADRANT_CONFIGS[oldQuadrant]?.name || oldQuadrant} to ${QUADRANT_CONFIGS[newQuadrant]?.name || newQuadrant}.` } : t));
    
    if (settings.enableCoaching && settings.apiKey) {
        try {
            const coachingResponse = await getAIMoveReasoning(task.name, QUADRANT_CONFIGS[oldQuadrant]?.name || oldQuadrant, QUADRANT_CONFIGS[newQuadrant]?.name || newQuadrant, settings.apiKey);
            if (coachingResponse.insight) {
                showToast(coachingResponse.insight, 'coach', 6000);
            }
        } catch (e: any) {
            console.warn("AI Coaching failed:", e.message);
        }
    }
  }, [tasks, updateTasks, settings.enableCoaching, settings.apiKey, showToast]);

  // --- AI Interaction Functions ---
  const classifyUnclassifiedTasks = async () => {
    const tasksToClassify = tasks.filter(t => t.status === 'active' && t.quadrant === 'unclassified' && !t.parentId);
    if (tasksToClassify.length === 0) {
        showToast("No unclassified tasks to process.", "info");
        return;
    }

    if (!settings.apiKey) {
        setIsApiKeyModalOpen(true);
        return;
    }

    setActionLoading('classifyAll');
    setGlobalError(null);
    let successfulClassifications = 0;

    try {
        const classificationPromises = tasksToClassify.map(async (task) => {
            try {
                const result = await performAIClassification(task, studentContext, tasks, !!task.recurring, settings.apiKey);
                successfulClassifications++;
                return { ...task, ...result, dueDate: result.suggestedDate || task.dueDate };
            } catch (e: any) {
                if (e.message?.includes("API key")) {
                    throw e; // Re-throw to fail Promise.all for API key errors
                }
                // For other errors, report them but don't reject the whole batch
                console.error(`Failed to classify task "${task.name}":`, e);
                setGlobalError(`AI classification failed for "${task.name}": ${e.message}.`);
                return { ...task, reasoning: `AI classification failed: ${e.message.substring(0, 100)}` };
            }
        });

        const results = await Promise.all(classificationPromises);
        const newTasks = tasks.map(t => results.find(r => r.id === t.id) || t);
        updateTasks(newTasks, successfulClassifications > 0 ? `${successfulClassifications} task(s) classified by AI.` : "AI classification attempted.");

    } catch (e: any) {
        if (e.message?.includes("API key")) {
            setIsApiKeyModalOpen(true);
        } else {
            setGlobalError(`A fatal error occurred during batch classification: ${e.message}`);
        }
    } finally {
        setActionLoading(false);
    }
};

  
const reclassifySingleTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (!settings.apiKey) {
        setIsApiKeyModalOpen(true);
        return;
    }

    setActionLoading(taskId);
    setGlobalError(null);
    try {
        const result = await performAIClassification(task, studentContext, tasks, !!task.recurring, settings.apiKey);
        const updatedTask = { ...task, ...result, dueDate: result.suggestedDate || task.dueDate };
        updateTasks(tasks.map(t => t.id === taskId ? updatedTask : t), `Task "${task.name}" re-classified by AI.`);
    } catch (e: any) {
        console.error(`Failed to re-classify task "${task.name}":`, e);
        if (e.message?.includes("API key")) {
            setIsApiKeyModalOpen(true);
        } else {
            setGlobalError(`AI re-classification failed for "${task.name}": ${e.message}`);
            updateTasks(tasks.map(t => t.id === taskId ? { ...t, reasoning: `AI re-classification failed: ${e.message.substring(0, 100)}` } : t));
        }
    } finally {
        setActionLoading(false);
    }
};

  const handleAIBreakdown = async (task: Task) => {
    if (!settings.apiKey) {
        setIsApiKeyModalOpen(true);
        return;
    }

    setSubtaskModal({ isOpen: true, data: { task, subtasks: [], isLoading: true } });
    setGlobalError(null);
    try {
        const breakdown = await performAIBreakdown(task.name, settings.apiKey);
        setSubtaskModal({ isOpen: true, data: { task, subtasks: breakdown.subtasks || [], isLoading: false } });
    } catch (e: any) {
        console.error("AI Breakdown failed:", e);
        if (e.message?.includes("API key")) {
            setSubtaskModal({ isOpen: false, data: null });
            setIsApiKeyModalOpen(true);
        } else {
            setGlobalError(`AI task breakdown failed: ${e.message}`);
            setSubtaskModal({ isOpen: true, data: { task, subtasks: [], isLoading: false } }); 
        }
    }
  };

  const handleGoToSettings = () => {
    setIsApiKeyModalOpen(false);
    setActiveTab('settings');
  };

  // --- Data Import/Export ---
  const handleExportData = () => {
      setActionLoading('export');
      try {
          const dataToExport = { tasks, studentContext, settings };
          const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(dataToExport, null, 2))}`;
          const link = document.createElement("a");
          link.href = jsonString;
          link.download = `ai_life_matrix_backup_${new Date().toISOString().split('T')[0]}.json`;
          link.click();
          showToast("Data exported successfully!");
      } catch (e: any) {
          setGlobalError(`Export failed: ${e.message}`);
      }
      setActionLoading(false);
  };

  const importInputRef = useRef<HTMLInputElement>(null);

  const handleImportData = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setActionLoading('import');
      setGlobalError(null); // Clear previous errors
      const reader = new FileReader();
      reader.onload = async (e) => {
          try {
              const importedData = JSON.parse(e.target.result as string);
              if (!importedData.tasks || !importedData.studentContext || !importedData.settings) {
                  throw new Error("Invalid import file format. Required fields missing: tasks, studentContext, or settings.");
              }
              if (!Array.isArray(importedData.tasks)) {
                  throw new Error("Imported tasks data is not in the correct format (should be an array).");
              }
              
              if (window.confirm("Are you sure you want to to import this data? This will overwrite your current tasks, context, and settings.")) {
                  await saveData('tasks', importedData.tasks);
                  setTasks(importedData.tasks); 
                  
                  await saveData('studentContext', importedData.studentContext);
                  setStudentContext(importedData.studentContext);

                  await saveData('settings', importedData.settings);
                  setSettings(importedData.settings);
                  
                  showToast("Data imported successfully!", "success");
              }
          } catch (err: any) {
              console.error("Import error:", err);
              setGlobalError(`Failed to import data: ${err.message}`);
          } finally {
              setActionLoading(false);
          }
      };
      reader.onerror = () => {
          setGlobalError("Failed to read the import file.");
          setActionLoading(false);
      }
      reader.readAsText(file);
      if (event.target) event.target.value = ''; 
  };

  // --- Render ---
  if (dataLoading && tasks.length === 0) { 
      return <div className="flex items-center justify-center min-h-screen bg-slate-50"><div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-600"></div></div>;
  }

  return (
      <div className="flex h-screen-large bg-slate-100 font-sans text-slate-800">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} tasks={tasks} user={user} />
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {(dataLoading || (typeof actionLoading === 'string' && actionLoading) || actionLoading === true) && (
             <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-50 rounded-2xl">
                 <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-blue-600"></div>
             </div>
          )}
          <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-20' : ''}`}> 
            <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
              <main className="space-y-8">
                {activeTab === 'dashboard' && <DashboardView user={user} tasks={tasks} onTaskStatusChange={handleTaskStatusChange} actionLoading={actionLoading} setEditModal={setEditModal} setInfoModal={setInfoModal} onReclassify={reclassifySingleTask} onBreakdown={handleAIBreakdown} handleMoveTaskQuadrant={handleMoveTaskQuadrant} context={studentContext} onContextUpdate={handleContextUpdate} settings={settings} showToast={showToast} setGlobalError={setGlobalError} setIsApiKeyModalOpen={setIsApiKeyModalOpen} />}
                {activeTab === 'matrix' && <EisenhowerMatrixView allTasks={tasks} moveTask={handleMoveTaskQuadrant} showInfo={setInfoModal} onClassify={classifyUnclassifiedTasks} onAddTask={handleAddTask} newTaskName={newTaskName} setNewTaskName={setNewTaskName} newDueDate={newDueDate} setNewDueDate={setNewDueDate} onTaskStatusChange={handleTaskStatusChange} onEditTask={setEditModal} onBreakdown={handleAIBreakdown} onReclassify={reclassifySingleTask} actionLoading={actionLoading} />}
                {activeTab === 'completed' && <CompletedListView tasks={tasks} onTaskStatusChange={handleTaskStatusChange} actionLoading={actionLoading} setEditModal={setEditModal} setInfoModal={setInfoModal} onReclassify={reclassifySingleTask} onBreakdown={handleAIBreakdown} handleMoveTaskQuadrant={handleMoveTaskQuadrant} />}
                {activeTab === 'trash' && <TrashListView tasks={tasks} onRecover={handleRecoverTask} onDelete={handlePermanentDelete} onEmpty={handleEmptyTrash} showInfo={setInfoModal} actionLoading={actionLoading} />}
                {activeTab === 'context' && <StudentContextFormView context={studentContext} setContext={setStudentContext} onSave={(ctx) => handleContextUpdate(ctx, "Context saved!")} actionLoading={actionLoading} />}
                {activeTab === 'settings' && <SettingsFormView settings={settings} setSettings={setSettings} onSave={(stg) => saveData('settings', stg, "Settings saved!")} onExport={handleExportData} onImportTrigger={() => importInputRef.current?.click()} actionLoading={actionLoading} user={user} />}
              </main>
              <footer className="text-center py-6 text-xs text-slate-400">
                Created by <a href="https://www.linkedin.com/in/vamsikrishna260" target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline">Vamsi Krishna</a>. Designed to reduce decision fatigue.
              </footer>
            </div>
          </div>
        </div>
        
        <ToastNotification toast={toast} setToast={setToast} />
        
        <InfoModal modalState={infoModal} closeModal={() => setInfoModal({ isOpen: false, data: null })} />
        <EditTaskModal modalState={editModal} closeModal={() => setEditModal({ isOpen: false, data: null})} onSave={handleUpdateTaskDetails}/>
        <SubtaskModal modalState={subtaskModal} closeModal={() => setSubtaskModal({ isOpen: false, data: null})} onAddSubtasks={handleAddSubtasks} />
        <ApiKeyModal isOpen={isApiKeyModalOpen} closeModal={() => setIsApiKeyModalOpen(false)} goToSettings={handleGoToSettings} />


        <input type="file" ref={importInputRef} onChange={handleImportData} className="hidden" accept=".json" />
        {isMobile && <MobileTabs activeTab={activeTab} setActiveTab={setActiveTab} tasks={tasks} />}
      </div>
  );
};


interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  tasks: Task[];
  user: User;
}
const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, tasks, user }) => {
    const trashCount = useMemo(() => tasks.filter(t => t.status === 'trashed' && !t.parentId).length, [tasks]);
    const TABS_CONFIG = [
        { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard, count: 0 },
        { id: 'matrix', label: 'Matrix View', icon: ICONS.matrix, count: 0 },
        { id: 'completed', label: 'Completed', icon: ICONS.completed, count: 0 },
        { id: 'trash', label: 'Trash', icon: ICONS.trash, count: trashCount },
        { id: 'context', label: 'User Context', icon: ICONS.context, count: 0 },
        { id: 'settings', label: 'Settings', icon: ICONS.settings, count: 0 },
    ];
    return (
        <aside className="hidden md:flex flex-col w-64 bg-white p-4 border-r border-slate-200">
            <div className="flex items-center gap-3 px-2 pb-6">
                <span className="text-blue-600">{ICONS.logo}</span>
                <h1 className="text-xl font-bold text-slate-800">AI Matrix</h1>
            </div>
            <nav className="flex-1 space-y-1">
                {TABS_CONFIG.map(tab => (
                    <button 
                        key={tab.id} 
                        onClick={() => setActiveTab(tab.id)} 
                        className={`flex items-center w-full text-left px-3 py-2.5 rounded-lg transition-all duration-200 group ${activeTab === tab.id ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
                        aria-current={activeTab === tab.id ? 'page' : undefined}
                    >
                        <span className={`transition-colors ${activeTab === tab.id ? 'text-blue-600' : 'text-slate-500 group-hover:text-slate-700'}`}>{tab.icon}</span>
                        <span className="ml-3 font-medium text-sm">{tab.label}</span>
                        {tab.count > 0 && <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`}>{tab.count}</span>}
                    </button>
                ))}
            </nav>
        </aside>
    );
};

const MobileTabs: React.FC<{ activeTab: string; setActiveTab: (tab: string) => void; tasks: Task[] }> = ({ activeTab, setActiveTab, tasks }) => {
    const trashCount = useMemo(() => tasks.filter(t => t.status === 'trashed' && !t.parentId).length, [tasks]);

    const TABS_CONFIG = [
        { id: 'dashboard', label: 'Home', icon: ICONS.dashboard, count: 0 },
        { id: 'matrix', label: 'Matrix', icon: ICONS.matrix, count: 0 },
        { id: 'completed', label: 'Done', icon: ICONS.completed, count: 0 },
        { id: 'trash', label: 'Trash', icon: ICONS.trash, count: trashCount },
        { id: 'settings', label: 'Settings', icon: ICONS.settings, count: 0 },
    ];

    return (
        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-lg shadow-[0_-2px_10px_rgba(0,0,0,0.05)] md:hidden z-30 border-t border-slate-200">
            <div className="flex justify-around items-center h-16">
                {TABS_CONFIG.map(tab => (
                    <button 
                        key={tab.id} 
                        onClick={() => setActiveTab(tab.id)} 
                        className={`flex flex-col items-center justify-center w-full h-full transition-all duration-300 relative ${activeTab === tab.id ? 'text-blue-600' : 'text-slate-500 hover:text-blue-500'}`}
                        aria-current={activeTab === tab.id ? "page" : undefined}
                    >
                        {activeTab === tab.id && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-blue-600 rounded-b-full transition-all duration-300"></div>}
                        <span className="text-2xl">{tab.icon}</span>
                        <span className="text-[11px] font-bold mt-1">{tab.label}</span>
                        {tab.count > 0 && (
                            <span className="absolute top-1 right-4 bg-rose-500 text-white text-[10px] font-bold w-4.5 h-4.5 rounded-full flex items-center justify-center">
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
};


interface ViewProps { actionLoading: boolean | string; } 
interface TaskViewProps extends ViewProps {
    tasks: Task[];
    onTaskStatusChange: (taskId: string, status: Task['status']) => void;
    setEditModal: (state: ModalState<Task>) => void;
    setInfoModal: (state: ModalState<Task>) => void;
    onReclassify: (taskId: string) => Promise<void>;
    onBreakdown: (task: Task) => Promise<void>;
    handleMoveTaskQuadrant: (taskId: string, oldQuadrant: QuadrantType, newQuadrant: QuadrantType) => void;
}


interface DashboardViewProps extends TaskViewProps {
    user: User;
    context: StudentContext;
    onContextUpdate: (newContext: StudentContext) => void;
    settings: AppSettings;
    showToast: (message: string, type: ToastData['type'], duration?: number) => void;
    setGlobalError: (message: string | null) => void;
    setIsApiKeyModalOpen: (isOpen: boolean) => void;
}

const DashboardView: React.FC<DashboardViewProps> = ({ user, tasks, onTaskStatusChange, actionLoading, setEditModal, setInfoModal, onReclassify, onBreakdown, handleMoveTaskQuadrant, context, onContextUpdate, settings, showToast, setGlobalError, setIsApiKeyModalOpen }) => {
    const doNowTasks = useMemo(() => tasks.filter(t => t.status === 'active' && t.quadrant === 'do' && !t.parentId).sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [tasks]);
    const userName = user.displayName || user.email?.split('@')[0] || "User";
    const today = new Date();
    const date = today.getDate();
    const day = today.toLocaleDateString('en-US', { weekday: 'long' });
    const monthYear = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const [suggestionLoading, setSuggestionLoading] = useState(false);

    const handleGetMoodSuggestion = async () => {
        if (!settings.apiKey) {
            setIsApiKeyModalOpen(true);
            return;
        }
        setSuggestionLoading(true);
        setGlobalError(null);
        try {
            const response = await getAIMoodSuggestion(context.mood, tasks, settings.apiKey);
            if (response.suggestion) {
                showToast(response.suggestion, 'coach', 8000);
            }
        } catch (e: any) {
            console.error("AI Mood Suggestion failed:", e);
            if (e.message?.includes("API key")) {
                setIsApiKeyModalOpen(true);
            } else {
                setGlobalError(`AI Suggestion failed: ${e.message}`);
            }
        } finally {
            setSuggestionLoading(false);
        }
    };
    
    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-slate-800">Welcome back, <span className="capitalize bg-gradient-to-r from-blue-600 to-sky-500 bg-clip-text text-transparent">{userName}</span>!</h2>
                    <p className="text-slate-500 mt-1 text-lg">Ready to conquer your day?</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                    <div className="text-center bg-white p-3 rounded-xl shadow-sm border border-slate-200 shrink-0">
                        <p className="text-4xl font-bold text-blue-600">{date}</p>
                        <p className="text-sm font-medium text-slate-600">{day}</p>
                        <p className="text-xs text-slate-400">{monthYear}</p>
                    </div>
                     <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200 flex-grow">
                        <label htmlFor="mood" className="block text-sm font-medium text-slate-700 text-center mb-2">Today's Mood</label>
                        <div className="flex items-center gap-2">
                             <select id="mood" value={context.mood} onChange={e => onContextUpdate({...context, mood: e.target.value})} className="w-full px-3 py-2 bg-slate-100 border-2 border-transparent rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-blue-500 transition-all text-sm">
                                {MOOD_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                            <button onClick={handleGetMoodSuggestion} disabled={suggestionLoading} className="p-2.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-blue-100 hover:text-blue-600 transition-colors disabled:opacity-50" title="Get AI Suggestion">
                                {suggestionLoading ? <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-slate-600"></div> : <span className="text-amber-500">{ICONS.lightbulb}</span>}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-md border border-slate-200">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-3 mb-4">
                     <span className={`w-3 h-3 rounded-full bg-rose-500`}></span>
                     <span>Your Priority Focus: <span className="text-rose-600">{QUADRANT_CONFIGS.do.name}</span></span>
                </h3>
                <div className="space-y-3">
                    {doNowTasks.length > 0 ? (
                        doNowTasks.map(task => <TaskItem key={task.id} task={task} allTasks={tasks} level={0} showInfo={setInfoModal} onTaskStatusChange={onTaskStatusChange} onEditTask={setEditModal} moveTask={handleMoveTaskQuadrant} onBreakdown={onBreakdown} onReclassify={onReclassify} actionLoading={actionLoading === task.id || actionLoading === true} quadrantBorderColor={QUADRANT_CONFIGS[task.quadrant]?.border} />)
                    ) : (
                        <div className="text-center py-10 px-4 bg-slate-50 rounded-lg border-2 border-dashed border-slate-200">
                            <div className="mx-auto h-12 w-12 text-green-500">{ICONS.allClear}</div>
                            <h3 className="mt-2 text-lg font-medium text-slate-800">All Clear!</h3>
                            <p className="mt-1 text-sm text-slate-500">No urgent tasks right now. Great job!</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

interface EisenhowerMatrixViewProps extends ViewProps {
  allTasks: Task[];
  moveTask: (taskId: string, oldQuadrant: QuadrantType, newQuadrant: QuadrantType) => void;
  showInfo: (state: ModalState<Task>) => void; 
  onClassify: () => Promise<void>;
  onAddTask: (e: React.FormEvent<HTMLFormElement>) => void;
  newTaskName: string;
  setNewTaskName: (name: string) => void;
  newDueDate: string;
  setNewDueDate: (date: string) => void;
  onTaskStatusChange: (taskId: string, status: Task['status']) => void;
  onEditTask: (state: ModalState<Task>) => void; 
  onBreakdown: (task: Task) => Promise<void>;
  onReclassify: (taskId: string) => Promise<void>;
}
const EisenhowerMatrixView: React.FC<EisenhowerMatrixViewProps> = (props) => {
    const { allTasks, moveTask, showInfo, onClassify, onReclassify, onAddTask, newTaskName, setNewTaskName, newDueDate, setNewDueDate, onTaskStatusChange, onEditTask, onBreakdown, actionLoading } = props;
    const quadrantsOrder: QuadrantType[] = ['do', 'schedule', 'delegate', 'delete'];
    const activeTasks = useMemo(() => allTasks.filter(t => t.status === 'active'), [allTasks]);
    const unclassifiedTasks = useMemo(() => activeTasks.filter(t => t.quadrant === 'unclassified' && !t.parentId).sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [activeTasks]);
    
    return (
        <div className="space-y-6">
             <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-md border border-slate-200 space-y-4">
                <form onSubmit={onAddTask} className="flex flex-col sm:flex-row items-center gap-3">
                    <input 
                        type="text" 
                        value={newTaskName} 
                        onChange={(e) => setNewTaskName(e.target.value)} 
                        placeholder="Add a new task and classify it..." 
                        className="flex-grow w-full px-4 py-3 bg-slate-100 border-2 border-transparent rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-blue-500 transition-all"
                    />
                    <input 
                        type="date" 
                        value={newDueDate} 
                        onChange={(e) => setNewDueDate(e.target.value)} 
                        title="Due Date (optional)" 
                        className="px-4 py-3 bg-slate-100 border-2 border-transparent rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-blue-500 transition-all sm:w-auto w-full text-slate-600"
                    />
                    <button 
                        type="submit" 
                        className="px-5 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 shadow-sm transition-transform hover:scale-105 sm:w-auto w-full flex items-center justify-center gap-2"
                    >
                        <span className="h-5 w-5">{ICONS.plus}</span>
                        Add Task
                    </button>
                </form>
            </div>

            {unclassifiedTasks.length > 0 && 
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-bold text-slate-800">Unclassified</h2>
                        <button 
                            onClick={onClassify} 
                            disabled={actionLoading === 'classifyAll'}
                            className="px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-full hover:bg-blue-700 shadow-md flex items-center justify-center gap-2 transition-all duration-300 transform hover:scale-105 disabled:opacity-50"
                        >
                            {actionLoading === 'classifyAll' ? ICONS.loadingSpinner : ICONS.magicWand}
                            <span className="text-sm">Classify with AI</span>
                        </button>
                    </div>
                    <QuadrantSquare 
                        key="unclassified" 
                        id="unclassified" 
                        quadrantConfig={QUADRANT_CONFIGS['unclassified']} 
                        allTasks={allTasks} 
                        tasks={unclassifiedTasks} 
                        moveTask={moveTask} 
                        showInfo={showInfo} 
                        onTaskStatusChange={onTaskStatusChange} 
                        onEditTask={onEditTask} 
                        onBreakdown={onBreakdown} 
                        onReclassify={onReclassify}
                        actionLoading={actionLoading}
                        isUnclassified
                        hideQuadrantBorder
                    />
                </div>
            }
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {quadrantsOrder.map(qId => {
                    const quadrantTasks = activeTasks.filter(t => t.quadrant === qId && !t.parentId).sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                    const currentQuadrantConfig = QUADRANT_CONFIGS[qId];
                    return (
                        <QuadrantSquare 
                            key={qId} 
                            id={qId} 
                            quadrantConfig={currentQuadrantConfig} 
                            allTasks={allTasks} 
                            tasks={quadrantTasks} 
                            moveTask={moveTask} 
                            showInfo={showInfo} 
                            onTaskStatusChange={onTaskStatusChange} 
                            onEditTask={onEditTask} 
                            onBreakdown={onBreakdown} 
                            onReclassify={onReclassify} 
                            actionLoading={actionLoading}
                            hideQuadrantBorder
                        />
                    );
                })}
            </div>
        </div>
    );
};

interface QuadrantSquareProps {
  id: QuadrantType;
  quadrantConfig: typeof QUADRANT_CONFIGS[QuadrantType];
  allTasks: Task[];
  tasks: Task[];
  moveTask: (taskId: string, oldQuadrant: QuadrantType, newQuadrant: QuadrantType) => void;
  showInfo: (state: ModalState<Task>) => void;
  onTaskStatusChange: (taskId: string, status: Task['status']) => void;
  onEditTask: (state: ModalState<Task>) => void;
  onBreakdown: (task: Task) => Promise<void>;
  onReclassify: (taskId: string) => Promise<void>;
  actionLoading: boolean | string;
  isUnclassified?: boolean;
  hideQuadrantBorder?: boolean;
}
const QuadrantSquare: React.FC<QuadrantSquareProps> = ({ id, quadrantConfig, allTasks, tasks, moveTask, showInfo, onTaskStatusChange, onEditTask, onBreakdown, onReclassify, actionLoading, isUnclassified = false, hideQuadrantBorder }) => {
  const isMobile = useIsMobile();
  const [{ isOver, canDrop }, drop] = useDrop<DraggableTaskItem, void, { isOver: boolean, canDrop: boolean }>(() => ({ 
      accept: ItemTypes.TASK, 
      drop: (item) => {
          if (item.quadrant !== id) { 
            moveTask(item.id, item.quadrant, id);
          }
      }, 
      canDrop: (item) => !isMobile && !item.parentId && item.quadrant !== id, 
      collect: (monitor: DropTargetMonitor<DraggableTaskItem, void>) => ({ 
          isOver: !!monitor.isOver(),
          canDrop: !!monitor.canDrop() 
      }) 
  }), [id, moveTask, isMobile]);
  
  return (
    <div 
        ref={(node) => { drop(node); }}
        className={`${quadrantConfig.bg} rounded-2xl p-4 min-h-[250px] transition-all duration-300 border-t-0 border-r-0 border-b-0 border-l-4 ${quadrantConfig.border} shadow-md
                    ${isOver && canDrop ? `ring-2 ring-offset-2 ${quadrantConfig.border} scale-[1.02]` : ''}
                    ${!canDrop && isOver ? 'ring-2 ring-offset-2 ring-red-400' : ''} 
                  `}
    >
      {!isUnclassified && <h3 className={`text-lg font-bold ${quadrantConfig.text} mb-3 pb-2 border-b border-slate-200`}>{quadrantConfig.name}</h3>}
      <div className="space-y-2">
        {tasks.map(task => 
            <TaskItem 
                key={task.id} 
                task={task} 
                allTasks={allTasks} 
                level={0} 
                showInfo={showInfo} 
                onTaskStatusChange={onTaskStatusChange} 
                onEditTask={onEditTask} 
                moveTask={moveTask} 
                onBreakdown={onBreakdown} 
                onReclassify={onReclassify}
                actionLoading={actionLoading === task.id || actionLoading === true}
                quadrantBorderColor={quadrantConfig.border}
                hideQuadrantBorder={hideQuadrantBorder}
            />
        )}
        {tasks.length === 0 && <div className={`h-full flex items-center justify-center text-sm italic text-slate-400 py-10`}>Drop tasks here...</div>}
      </div>
    </div>
  );
};

interface TaskItemProps {
  task: Task;
  allTasks: Task[];
  level: number;
  showInfo: (state: ModalState<Task>) => void;
  onTaskStatusChange: (taskId: string, status: Task['status']) => void;
  onEditTask: (state: ModalState<Task>) => void;
  moveTask: (taskId: string, oldQuadrant: QuadrantType, newQuadrant: QuadrantType) => void;
  onBreakdown: (task: Task) => Promise<void>;
  onReclassify: (taskId: string) => Promise<void>;
  isDraggable?: boolean;
  actionLoading?: boolean;
  quadrantBorderColor?: string; 
  hideQuadrantBorder?: boolean;
}
const TaskItem: React.FC<TaskItemProps> = ({ task, allTasks, level, showInfo, onTaskStatusChange, onEditTask, moveTask, onBreakdown, onReclassify, isDraggable = true, actionLoading, quadrantBorderColor, hideQuadrantBorder = false }) => {
  const isMobile = useIsMobile();
  const canDrag = isDraggable && !isMobile && !task.parentId; 
  const [{ isDragging }, drag, preview] = useDrag<DraggableTaskItem, void, { isDragging: boolean }>(() => ({ 
      type: ItemTypes.TASK, 
      item: { id: task.id, quadrant: task.quadrant, parentId: task.parentId }, 
      canDrag: canDrag,
      collect: (monitor) => ({ isDragging: !!monitor.isDragging() }) 
  }), [task.id, task.quadrant, task.parentId, isMobile, isDraggable]);
  
  const subtasks = useMemo(() => allTasks.filter(t => t.parentId === task.id && t.status === task.status).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [allTasks, task.id, task.status]);

  const borderClass = task.status === 'completed' 
    ? 'border-slate-200' 
    : (quadrantBorderColor || 'border-slate-300');

  return (
    <div ref={(node) => { preview(node); }} className={`transition-opacity duration-300 ${task.status === 'completed' ? 'opacity-60' : 'opacity-100'} ${isDragging ? 'opacity-30' : ''}`}>
        <div 
            ref={(node) => { drag(node); }}
            style={{ marginLeft: `${level * 16}px`}} 
            className={`flex items-center p-2 bg-white rounded-lg transition-all border-l-4 ${hideQuadrantBorder ? 'border-transparent' : borderClass} hover:shadow-md group shadow-sm hover:bg-slate-50
                        ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''} 
                        ${isDragging ? `ring-2 ring-blue-500 shadow-lg scale-105` : ''}
                      `}
        >
            <input 
                type="checkbox" 
                checked={task.status === 'completed'} 
                className="h-5 w-5 rounded-md border-slate-300 text-blue-600 focus:ring-blue-500 focus:ring-2 ml-1 mr-3 shrink-0 cursor-pointer transition-colors" 
                onChange={() => onTaskStatusChange(task.id, task.status === 'completed' ? 'active' : 'completed')}
                aria-label={`Mark task ${task.name} as ${task.status === 'completed' ? 'active' : 'completed'}`}
            />
            <span className={`flex-1 text-slate-800 mr-2 text-sm ${task.status === 'completed' ? 'line-through text-slate-500' : ''}`}>{task.name}</span>
            
            <div className="flex items-center ml-auto pl-2 space-x-2">
                {!task.parentId && <DueDateDisplay dueDate={task.dueDate} />}
                <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200">
                     {actionLoading ? (
                        <div className="p-1" aria-label="Loading action">
                            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-blue-600"></div>
                        </div>
                     ) : (
                        <TaskActions 
                            task={task} 
                            showInfo={showInfo} 
                            onEditTask={onEditTask} 
                            onTaskStatusChange={onTaskStatusChange} 
                            moveTask={moveTask} 
                            onBreakdown={onBreakdown} 
                            onReclassify={onReclassify} 
                            isMobile={isMobile}
                        />
                     )}
                </div>
            </div>
        </div>
        {subtasks.length > 0 && <div className="mt-1 space-y-1">{subtasks.map(sub => <TaskItem key={sub.id} task={sub} allTasks={allTasks} level={level + 1} showInfo={showInfo} onTaskStatusChange={onTaskStatusChange} onEditTask={onEditTask} moveTask={moveTask} onBreakdown={onBreakdown} onReclassify={onReclassify} isDraggable={false} actionLoading={actionLoading} quadrantBorderColor={quadrantBorderColor} hideQuadrantBorder={hideQuadrantBorder} />)}</div>}
    </div>);
};

interface TaskActionsProps {
  task: Task;
  showInfo: (state: ModalState<Task>) => void;
  onEditTask: (state: ModalState<Task>) => void;
  onTaskStatusChange: (taskId: string, status: Task['status']) => void;
  moveTask: (taskId: string, oldQuadrant: QuadrantType, newQuadrant: QuadrantType) => void;
  onBreakdown: (task: Task) => Promise<void>;
  onReclassify: (taskId: string) => Promise<void>;
  isMobile: boolean;
}
const TaskActions: React.FC<TaskActionsProps> = ({ task, showInfo, onEditTask, onTaskStatusChange, moveTask, onBreakdown, onReclassify, isMobile }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => { 
        const handleClickOutside = (event: MouseEvent) => { 
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false); 
            }
        }; 
        document.addEventListener("mousedown", handleClickOutside); 
        return () => document.removeEventListener("mousedown", handleClickOutside); 
    }, [menuRef]);

    const isTopLevel = !task.parentId;
    const commonButtonClass = "flex items-center gap-3 w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md transition-colors";

    return (
        <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen(prev => !prev)} className="text-slate-500 hover:text-blue-600 p-1.5 rounded-full hover:bg-slate-200 transition-colors" aria-label="More actions">
                {ICONS.more}
            </button>
            {menuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl z-20 border border-slate-200 p-1.5">
                    <button onClick={() => { showInfo({ isOpen: true, data: task }); setMenuOpen(false); }} className={commonButtonClass}>{ICONS.info} Info</button>
                    <button onClick={() => { onEditTask({ isOpen: true, data: task }); setMenuOpen(false); }} className={commonButtonClass}>{ICONS.edit} Edit / Recur</button>
                    {isTopLevel && <button onClick={() => { onBreakdown(task); setMenuOpen(false); }} className={commonButtonClass}>{ICONS.breakdown} AI Breakdown</button>}
                    {isTopLevel && task.quadrant !== 'unclassified' && <button onClick={() => { onReclassify(task.id); setMenuOpen(false); }} className={commonButtonClass}>{ICONS.aiReclassify} Re-classify with AI</button>}
                    {isMobile && isTopLevel && (
                        <div className="border-t border-slate-100 my-1">
                            {Object.keys(QUADRANT_CONFIGS).filter(q => q !== 'unclassified' && q !== task.quadrant).map(qId => (
                                <button key={qId} onClick={() => { moveTask(task.id, task.quadrant, qId as QuadrantType); setMenuOpen(false); }} className={`${commonButtonClass} capitalize`}><span className={`${QUADRANT_CONFIGS[qId as QuadrantType].iconColor}`}>{ICONS.move}</span><span>Move to {QUADRANT_CONFIGS[qId as QuadrantType].name}</span></button>
                            ))}
                        </div>
                    )}
                    <div className="border-t border-slate-100 my-1"></div>
                    <button onClick={() => { onTaskStatusChange(task.id, 'trashed'); setMenuOpen(false); }} className={`${commonButtonClass} text-red-600 hover:bg-red-50`}>{ICONS.trashAction} Delete</button>
                </div>
            )}
        </div>
    );
};

const DueDateDisplay: React.FC<{ dueDate: string | null | undefined }> = ({ dueDate }) => {
    if (!dueDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0); 
    const due = new Date(`${dueDate}T00:00:00`); 

    const diffTime = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return <span className="text-xs font-semibold text-red-700 bg-red-100 px-2 py-1 rounded-full whitespace-nowrap">Overdue</span>;
    if (diffDays === 0) return <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-1 rounded-full whitespace-nowrap">Today</span>;
    if (diffDays <= 7) return <span className="text-xs font-medium text-sky-800 bg-sky-100 px-2 py-1 rounded-full whitespace-nowrap">{diffDays}d left</span>;
    return <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-full whitespace-nowrap">{new Date(dueDate+'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>;
};


const CompletedListView: React.FC<TaskViewProps> = ({ tasks, onTaskStatusChange, actionLoading, setEditModal, setInfoModal, onReclassify, onBreakdown, handleMoveTaskQuadrant }) => {
    const completedTasks = useMemo(() => tasks.filter(t => t.status === 'completed' && !t.parentId).sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [tasks]);
    return (
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-md border border-slate-200">
            <h2 className="text-2xl font-bold text-slate-800 mb-6">Completed Tasks</h2>
            <div className="space-y-3">
                {completedTasks.length > 0 ? completedTasks.map(task => (
                    <TaskItem key={task.id} task={task} allTasks={tasks} level={0} showInfo={setInfoModal} onTaskStatusChange={onTaskStatusChange} onEditTask={setEditModal} moveTask={handleMoveTaskQuadrant} onBreakdown={onBreakdown} onReclassify={onReclassify} isDraggable={false} actionLoading={actionLoading === task.id || actionLoading === true} quadrantBorderColor="border-slate-300" />
                )) : <p className="text-slate-500 italic py-8 text-center">No completed tasks yet. Keep up the great work!</p>}
            </div>
        </div>
    );
};

interface TrashListViewProps extends ViewProps {
  tasks: Task[];
  onRecover: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onEmpty: () => void;
  showInfo: (state: ModalState<Task>) => void;
}
const TrashListView: React.FC<TrashListViewProps> = ({ tasks, onRecover, onDelete, onEmpty, showInfo, actionLoading }) => {
    const trashedTasks = useMemo(() => tasks.filter(t => t.status === 'trashed' && !t.parentId).sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [tasks]);
    return (
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-md border border-slate-200">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-3">
                 <h2 className="text-2xl font-bold text-slate-800">Trashed Tasks</h2>
                 {trashedTasks.length > 0 && 
                    <button 
                        onClick={onEmpty} 
                        disabled={actionLoading === 'emptyTrash'} 
                        className="px-4 py-2 text-sm font-semibold text-red-600 bg-red-100 hover:bg-red-200 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 shadow-sm hover:scale-105 transform disabled:cursor-not-allowed"
                    >
                        {actionLoading === 'emptyTrash' ? ICONS.loadingSpinner : <span className="text-red-500 group-hover:text-red-600">{ICONS.trashAction}</span>} 
                        Empty Trash
                    </button>
                }
            </div>
            <div className="space-y-3">
                {trashedTasks.length > 0 ? trashedTasks.map(task => (
                    <div key={task.id} className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex items-center justify-between gap-2 hover:shadow-sm transition-shadow">
                        <span className="text-slate-600 text-sm truncate flex-grow" title={task.name}>{task.name}</span>
                        <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
                            <button onClick={() => showInfo({isOpen: true, data: task})} className="text-slate-500 hover:text-blue-600 p-1.5 rounded-full hover:bg-slate-200 transition-colors" title="Info">{ICONS.info}</button>
                            <button onClick={() => onRecover(task.id)} className="text-slate-500 hover:text-green-600 p-1.5 rounded-full hover:bg-slate-200 transition-colors" title="Recover">{ICONS.recover}</button>
                            <button 
                                onClick={() => onDelete(task.id)} 
                                disabled={actionLoading === `delete-${task.id}`}
                                className="text-slate-500 hover:text-red-600 p-1.5 rounded-full hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" 
                                title="Delete Permanently"
                            >
                                {actionLoading === `delete-${task.id}` ? <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-red-500"></div> : <span className="text-red-500 group-hover:text-red-600">{ICONS.deletePermanent}</span> }
                            </button>
                        </div>
                    </div>
                )) : <p className="text-slate-500 italic py-8 text-center">Trash is empty.</p>}
            </div>
        </div>
    );
};

const Card: React.FC<{title: string, description: string, children: React.ReactNode}> = ({title, description, children}) => (
    <div className="bg-white p-5 sm:p-6 rounded-2xl shadow-md border border-slate-200">
        <h2 className="text-2xl font-bold text-slate-800">{title}</h2>
        <p className="text-slate-500 mt-1 text-sm mb-6">{description}</p>
        {children}
    </div>
)

interface StudentContextFormViewProps extends ViewProps {
  context: StudentContext;
  setContext: React.Dispatch<React.SetStateAction<StudentContext>>;
  onSave: (context: StudentContext) => void;
}
const StudentContextFormView: React.FC<StudentContextFormViewProps> = ({ context, setContext, onSave, actionLoading }) => {
    const handleSave = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); onSave(context); };
    const commonInputClass = "w-full px-4 py-3 bg-slate-100 border-2 border-transparent rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-blue-500 transition-all";
    const commonLabelClass = "block text-sm font-medium text-slate-700 mb-2";

    return (
        <Card title="Student Context" description="Provide context for the AI. The more details, the smarter the classification and suggestions.">
            <form onSubmit={handleSave} className="space-y-6">
                <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
                    <div><label htmlFor="exams" className={commonLabelClass}>Upcoming Exams</label><input type="text" id="exams" value={context.exams.text} onChange={e => setContext({...context, exams: {...context.exams, text: e.target.value}})} className={commonInputClass} placeholder="e.g., Final Physics exam" /></div>
                    <div><label htmlFor="exam_date" className={commonLabelClass}>Exam Date(s)</label><input type="text" id="exam_date" value={context.exams.date} onChange={e => setContext({...context, exams: {...context.exams, date: e.target.value}})} className={commonInputClass} placeholder="e.g., YYYY-MM-DD" /></div>
                </div>
                <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
                    <div><label htmlFor="assignments" className={commonLabelClass}>Major Assignments/Projects</label><input type="text" id="assignments" value={context.assignments.text} onChange={e => setContext({...context, assignments: {...context.assignments, text: e.target.value}})} className={commonInputClass} placeholder="e.g., History paper" /></div>
                    <div><label htmlFor="assignment_date" className={commonLabelClass}>Assignment Due Date(s)</label><input type="text" id="assignment_date" value={context.assignments.date} onChange={e => setContext({...context, assignments: {...context.assignments, date: e.target.value}})} className={commonInputClass} placeholder="e.g., YYYY-MM-DD" /></div>
                </div>
                <div><label htmlFor="goals" className={commonLabelClass}>Current Goals</label><input type="text" id="goals" value={context.goals} onChange={e => setContext({...context, goals: e.target.value})} className={commonInputClass} placeholder="e.g., Apply for 3 internships" /></div>
                <div><label htmlFor="openContext" className={commonLabelClass}>Other Relevant Information</label><textarea id="openContext" value={context.openContext} onChange={e => setContext({...context, openContext: e.target.value})} rows={3} className={commonInputClass} placeholder="e.g., Part-time job on Tue/Thu evenings."></textarea></div>
                <div className="flex justify-end pt-2"><button type="submit" disabled={typeof actionLoading === 'string' && actionLoading === 'saveContext'} className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 shadow-md transition-all duration-300 transform hover:scale-105 flex items-center justify-center gap-2 disabled:opacity-50">
                {actionLoading === 'saveContext' ? ICONS.loadingSpinner : ICONS.context } Save Context
                </button></div>
            </form>
        </Card>
    );
};


const AccordionItem: React.FC<{
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
}> = ({ title, icon, children, defaultOpen = false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden transition-all duration-300">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 sm:p-5 text-left"
                aria-expanded={isOpen}
            >
                <div className="flex items-center gap-4">
                    <span className="text-blue-600">{icon}</span>
                    <h3 className="text-lg font-bold text-slate-800">{title}</h3>
                </div>
                <span className={`text-slate-500 transform transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
                    {ICONS.chevronDown}
                </span>
            </button>
            <div 
                className="grid transition-all duration-500 ease-in-out"
                style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
            >
                <div className="overflow-hidden">
                    <div className="p-4 sm:p-6 border-t border-slate-200/80">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
};


interface SettingsFormViewProps extends ViewProps {
  user: User;
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  onSave: (settings: AppSettings) => void;
  onExport: () => void;
  onImportTrigger: () => void;
}
const SettingsFormView: React.FC<SettingsFormViewProps> = ({ user, settings, setSettings, onSave, onExport, onImportTrigger, actionLoading }) => {
    const handleSave = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); onSave(settings); };
    const commonInputClass = "w-full px-4 py-3 bg-slate-100 border-2 border-transparent rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-blue-500 transition-all";
    const commonLabelClass = "block text-sm font-medium text-slate-700 mb-2";

    return (
        <div className="space-y-4">
            <AccordionItem title="What Makes This App Special?" icon={ICONS.star}>
                <ul className="space-y-3 text-slate-600 list-disc list-inside text-sm">
                    <li><strong className="text-slate-800">Smart Prioritization:</strong> Leverages the Gemini AI model to automatically classify your tasks into the Eisenhower Matrix, saving you time and mental energy.</li>
                    <li><strong className="text-slate-800">Task Breakdown:</strong> Complex projects can be broken down into manageable sub-tasks with a single click, powered by AI.</li>
                    <li><strong className="text-slate-800">Personalized Context:</strong> The AI considers your unique goals, deadlines, and even mood to provide tailored recommendations.</li>
                    <li><strong className="text-slate-800">Seamless Offline Mode:</strong> Thanks to Firestore, the app works perfectly even without an internet connection. Your changes sync automatically when you're back online.</li>
                    <li><strong className="text-slate-800">Clean & Focused UI:</strong> A minimalist, responsive design that helps you focus on your tasks without distractions.</li>
                </ul>
            </AccordionItem>

            <AccordionItem title="AI Configuration & Settings" icon={ICONS.settings} defaultOpen>
                <form onSubmit={handleSave} className="space-y-6">
                    <div>
                        <label htmlFor="userApiKey" className={commonLabelClass}>Your Personal Gemini API Key</label>
                        <input 
                            type="password" 
                            id="userApiKey" 
                            value={settings.apiKey} 
                            onChange={e => setSettings({...settings, apiKey: e.target.value})} 
                            className={commonInputClass} 
                            placeholder="Enter your personal Gemini API key" 
                        />
                        <p className="text-xs text-slate-500 mt-2">
                            Your key is stored securely and only used to power AI features. Get a key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">Google AI Studio</a>.
                        </p>
                        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                           <span className="font-bold">Cost-Effective AI:</span> The {GEMINI_MODEL_NAME} model is very efficient. For context, $1.00 USD should be enough to classify or break down well over <strong>6,500 tasks</strong>.
                        </div>
                    </div>
                     <div className="flex items-center justify-between">
                         <div className="flex items-center">
                            <input type="checkbox" id="enableCoaching" checked={settings.enableCoaching} onChange={e => setSettings({...settings, enableCoaching: e.target.checked})} className="h-4 w-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500" />
                            <label htmlFor="enableCoaching" className="ml-2 block text-sm text-slate-900">Enable AI Coach for task moves</label>
                         </div>
                         <button type="submit" disabled={typeof actionLoading === 'string' && actionLoading === 'saveSettings'} className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 shadow-md transition-all duration-300 transform hover:scale-105 flex items-center justify-center gap-2 disabled:opacity-50">
                            {actionLoading === 'saveSettings' ? ICONS.loadingSpinner : ICONS.settings} Save Settings
                         </button>
                    </div>
                </form>
            </AccordionItem>

            <AccordionItem title="Data Management" icon={ICONS.exportIcon}>
                <div className="space-y-4">
                    <p className="text-slate-600 text-sm">Export a backup of your data or import a previous backup file. Exports include tasks, context, and settings. Imports will overwrite existing data.</p>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <button onClick={onExport} disabled={actionLoading === 'export'} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 shadow-md transition-all duration-300 transform hover:scale-105 disabled:opacity-50">{actionLoading === 'export' ? ICONS.loadingSpinner : ICONS.exportIcon} Export Data</button>
                        <button onClick={onImportTrigger} disabled={actionLoading === 'import'} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-700 text-white font-semibold rounded-lg hover:bg-slate-800 shadow-md transition-all duration-300 transform hover:scale-105 disabled:opacity-50">{actionLoading === 'import' ? ICONS.loadingSpinner : ICONS.importIcon} Import Data</button>
                    </div>
                </div>
            </AccordionItem>

            <AccordionItem title="How to Use This App" icon={ICONS.map}>
                <ol className="space-y-3 text-slate-600 list-decimal list-inside text-sm">
                    <li><strong className="text-slate-800">Set Your Context:</strong> Navigate to the 'User Context' tab to help the AI make smarter recommendations.</li>
                    <li><strong className="text-slate-800">Add & Classify:</strong> Go to 'Matrix View' to add tasks. Use the "Classify with AI" button for automatic categorization.</li>
                    <li><strong className="text-slate-800">Organize:</strong> Drag & drop tasks between quadrants (desktop) or use the 'Move to' action menu (mobile).</li>
                    <li><strong className="text-slate-800">Sub-tasks:</strong> Use the "AI Breakdown" action to split complex tasks into smaller steps.</li>
                    <li><strong className="text-slate-800">Review & Complete:</strong> The 'Dashboard' shows your immediate priorities. Check off tasks as you finish them.</li>
                    <li><strong className="text-slate-800">Recurring Tasks:</strong> Set tasks to repeat via the "Edit / Recur" action. New instances are created upon completion.</li>
                </ol>
            </AccordionItem>

             <AccordionItem title="About the Creator" icon={ICONS.creatorIcon}>
                <div className="flex flex-col items-center text-center">
                    <h4 className="text-2xl font-bold text-blue-700">Vamsi Krishna</h4>
                    <p className="text-slate-500 font-medium mt-1">Productivity Enthusiast | Lifelong Learner</p>
                    <p className="mt-4 text-slate-600 max-w-xl text-base">
                       I'm Vamsi Krishna, a developer passionate about building tools that enhance productivity and reduce cognitive load. This AI-powered Eisenhower Matrix is a tool I developed to help students and professionals focus on what truly matters by automating task prioritization. I hope it helps you achieve your goals!
                    </p>
                    <a href="https://www.linkedin.com/in/vamsikrishna260" target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex items-center gap-3 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 shadow-md transition-all duration-300 transform hover:scale-105">
                        <span className="h-6 w-6">{ICONS.linkedin}</span>
                        <span>Connect on LinkedIn</span>
                    </a>
                </div>
            </AccordionItem>

            <div className="mt-8 pt-6 border-t border-slate-200/80">
                <p className="text-sm text-center text-slate-500 mb-3 truncate" title={user.email || 'User'}>
                    Signed in as: <strong className="text-slate-700">{user.email || 'User'}</strong>
                </p>
                <button 
                    onClick={() => signOut().catch(e => console.error("Sign out error", e))} 
                    className="w-full max-w-xs mx-auto flex items-center justify-center gap-3 text-left px-3 py-2.5 rounded-lg transition-all duration-200 group text-red-600 bg-red-50/50 hover:bg-red-100 hover:text-red-700 border border-red-200"
                >
                    <span className="text-red-500 group-hover:text-red-600">{ICONS.signOut}</span>
                    <span className="font-semibold text-sm">Sign Out</span>
                </button>
            </div>
        </div>
    );
};

const Modal: React.FC<{isOpen: boolean, closeModal: () => void, children: React.ReactNode}> = ({isOpen, closeModal, children}) => {
    const modalRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (isOpen) {
            triggerRef.current = document.activeElement as HTMLElement;

            const focusableElementsQuery = 'a[href]:not([disabled]), button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
            
            // Timeout to allow modal animation to complete before focusing
            const focusTimer = setTimeout(() => {
                modalRef.current?.querySelector<HTMLElement>(focusableElementsQuery)?.focus();
            }, 100);

            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    closeModal();
                    return;
                }

                if (e.key === 'Tab' && modalRef.current) {
                    const focusableElements = Array.from(
                        modalRef.current.querySelectorAll<HTMLElement>(focusableElementsQuery)
                    );
                    if (focusableElements.length === 0) {
                        e.preventDefault();
                        return;
                    }
                    const firstElement = focusableElements[0];
                    const lastElement = focusableElements[focusableElements.length - 1];

                    if (e.shiftKey) { // Shift + Tab
                        if (document.activeElement === firstElement) {
                            lastElement.focus();
                            e.preventDefault();
                        }
                    } else { // Tab
                        if (document.activeElement === lastElement) {
                            firstElement.focus();
                            e.preventDefault();
                        }
                    }
                }
            };

            document.addEventListener('keydown', handleKeyDown);

            return () => {
                clearTimeout(focusTimer);
                document.removeEventListener('keydown', handleKeyDown);
                triggerRef.current?.focus();
            };
        }
    }, [isOpen, closeModal]);

    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-start sm:items-center justify-center z-[60] p-4 pt-16 sm:pt-4 animate-fade-in" 
            onClick={closeModal} 
            role="dialog" 
            aria-modal="true"
        >
            <div 
                ref={modalRef} 
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-scale-in" 
                onClick={e => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
};

const InfoModal: React.FC<{ modalState: ModalState<Task>; closeModal: () => void; }> = ({ modalState, closeModal }) => {
    const { isOpen, data: task } = modalState;
    if (!isOpen || !task) return null;
    const quadrantInfo = QUADRANT_CONFIGS[task.quadrant] || QUADRANT_CONFIGS.unclassified;
    
    return (
        <Modal isOpen={isOpen} closeModal={closeModal}>
            <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                    <h3 className="text-2xl font-bold text-slate-800 break-words">{task.name}</h3>
                    <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 p-1 -mt-1 -mr-1 rounded-full hover:bg-slate-100 transition-colors">{ICONS.close}</button>
                </div>
                <div className="space-y-4 text-sm">
                    {!task.parentId && <div><p className="font-medium text-slate-500">Current Quadrant:</p><span className={`inline-block mt-1 font-bold px-3 py-1 rounded-full text-xs ${quadrantInfo.text} ${quadrantInfo.bg.replace('bg-', 'bg-')}`.replace('white', 'slate-100')}>{quadrantInfo.name}</span></div>}
                    {task.reasoning && <div className="p-3 bg-slate-50 rounded-lg border border-slate-200"><p className="font-medium text-slate-500">AI Reasoning:</p><p className="text-slate-700 mt-1 italic">"{task.reasoning}"</p></div>}
                    {task.dateReasoning && <div className="p-3 bg-blue-50 rounded-lg border border-blue-200"><p className="font-medium text-blue-500">AI Date Reasoning:</p><p className="text-blue-700 mt-1 italic">"{task.dateReasoning}"</p></div>}
                    {task.schedulingHint && <div className="p-3 bg-purple-50 rounded-lg border border-purple-200"><p className="font-medium text-purple-500">AI Scheduling Hint:</p><p className="text-purple-700 mt-1 italic">"{task.schedulingHint}"</p></div>}
                    {!task.parentId && <div><p className="font-medium text-slate-500">Due Date:</p><p className="text-slate-700">{task.dueDate ? new Date(task.dueDate+'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Not set'}</p></div>}
                    <div><p className="font-medium text-slate-500">Created At:</p><p className="text-slate-700">{new Date(task.createdAt).toLocaleString()}</p></div>
                     {task.recurring && task.recurring.type !== 'none' && (
                        <div><p className="font-medium text-slate-500">Recurring:</p><p className="text-slate-700 capitalize">Every {task.recurring.interval > 1 ? task.recurring.interval : ''} {task.recurring.interval > 1 ? task.recurring.type.replace('ly', 'lies') : task.recurring.type}</p></div>
                    )}
                </div>
            </div>
            <div className="p-4 bg-slate-50 rounded-b-2xl flex justify-end"><button onClick={closeModal} className="px-5 py-2 bg-slate-200 text-slate-800 font-semibold rounded-lg hover:bg-slate-300 transition-colors transform hover:scale-105">Close</button></div>
        </Modal>
    );
};

interface EditTaskModalProps {
  modalState: ModalState<Task>;
  closeModal: () => void;
  onSave: (taskId: string, newName: string, newDueDate: string, newRecurring: RecurringSettings | null) => void;
}
const EditTaskModal: React.FC<EditTaskModalProps> = ({ modalState, closeModal, onSave }) => {
    const [name, setName] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [recurring, setRecurring] = useState<RecurringSettings>({ type: 'none', interval: 1 });

    const isTopLevel = modalState.isOpen && modalState.data && !modalState.data.parentId;

    useEffect(() => { 
        if(modalState.isOpen && modalState.data) { 
            setName(modalState.data.name); 
            setDueDate(modalState.data.dueDate || ''); 
            setRecurring(modalState.data.recurring || { type: 'none', interval: 1 });
        }
    }, [modalState]);

    if (!modalState.isOpen || !modalState.data) return null;

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => { 
        e.preventDefault(); 
        if (!name.trim()) { alert("Task name cannot be empty."); return; }
        onSave(modalState.data!.id, name.trim(), dueDate, recurring.type === 'none' ? null : recurring); 
    };
    
    const commonInputClass = "w-full px-4 py-3 bg-slate-100 border-2 border-transparent rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-blue-500 transition-all";
    const commonLabelClass = "block text-sm font-medium text-slate-700 mb-1";

    return (
        <Modal isOpen={modalState.isOpen} closeModal={closeModal}>
            <form onSubmit={handleSubmit}>
                <div className="p-6">
                    <div className="flex justify-between items-start mb-4"><h3 className="text-2xl font-bold text-slate-800">Edit Task</h3><button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-600 p-1 -mt-1 -mr-1 rounded-full hover:bg-slate-100 transition-colors">{ICONS.close}</button></div>
                    <div className="space-y-4">
                        <div><label htmlFor="taskNameEdit" className={commonLabelClass}>Task Name</label><input type="text" id="taskNameEdit" value={name} onChange={e => setName(e.target.value)} className={commonInputClass} required/></div>
                        {isTopLevel && <div><label htmlFor="dueDateEdit" className={commonLabelClass}>Due Date</label><input type="date" id="dueDateEdit" value={dueDate} onChange={e => setDueDate(e.target.value)} className={commonInputClass}/></div>}
                        {isTopLevel && <div className="border-t border-slate-200 pt-4">
                            <h4 className="text-md font-semibold text-slate-700 mb-2">Recurring Task</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label htmlFor="recurringType" className={`${commonLabelClass} text-xs`}>Frequency</label><select id="recurringType" value={recurring.type} onChange={e => setRecurring({...recurring, type: e.target.value as RecurringSettings['type']})} className={commonInputClass}><option value="none">None</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
                                {recurring.type !== 'none' && <div><label htmlFor="recurringInterval" className={`${commonLabelClass} text-xs`}>Every</label><input type="number" id="recurringInterval" min="1" value={recurring.interval} onChange={e => setRecurring({...recurring, interval: Math.max(1, parseInt(e.target.value, 10) || 1)})} className={commonInputClass} /></div>}
                            </div>
                        </div>}
                    </div>
                </div>
                <div className="p-4 bg-slate-50 rounded-b-2xl flex justify-end space-x-3">
                    <button type="button" onClick={closeModal} className="px-5 py-2 bg-slate-200 text-slate-800 font-semibold rounded-lg hover:bg-slate-300 transition-colors">Cancel</button>
                    <button type="submit" className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm">Save Changes</button>
                </div>
            </form>
        </Modal>
    );
};

interface SubtaskModalProps {
  modalState: ModalState<SubtaskModalData>;
  closeModal: () => void;
  onAddSubtasks: (subtaskNames: string[], parentTask: Task) => void;
}
const SubtaskModal: React.FC<SubtaskModalProps> = ({ modalState, closeModal, onAddSubtasks }) => {
    const [selectedSubtasks, setSelectedSubtasks] = useState<Record<number, boolean>>({});

    useEffect(() => {
        if (modalState.isOpen && modalState.data?.subtasks) {
            setSelectedSubtasks(modalState.data.subtasks.reduce((acc, _, i) => ({ ...acc, [i]: true }), {}));
        }
    }, [modalState]);

    if (!modalState.isOpen || !modalState.data) return null;
    const { task, subtasks, isLoading } = modalState.data;

    const handleToggle = (index: number) => setSelectedSubtasks(prev => ({ ...prev, [index]: !prev[index] }));
    const handleAdd = () => onAddSubtasks(subtasks.filter((_, i) => selectedSubtasks[i]), task);

    return (
        <Modal isOpen={modalState.isOpen} closeModal={closeModal}>
            <div className="p-6">
                <div className="flex justify-between items-start mb-2"><h3 className="text-2xl font-bold text-slate-800">AI Task Breakdown</h3><button onClick={closeModal} className="text-slate-400 hover:text-slate-600 p-1 -mt-1 -mr-1 rounded-full hover:bg-slate-100 transition-colors">{ICONS.close}</button></div>
                <p className="text-slate-600 mb-4 text-sm">AI suggested these sub-tasks for <strong className="text-slate-800">"{task.name}"</strong>. Select which ones to add.</p>
                {isLoading ? (
                    <div className="flex justify-center items-center h-48"><div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-blue-600"></div></div>
                ) : (
                    <div className="space-y-3 max-h-64 overflow-y-auto pr-2 border rounded-lg p-3 bg-slate-50">
                        {subtasks?.length > 0 ? subtasks.map((sub, i) => (
                            <div key={i} className="flex items-center bg-white p-3 rounded-lg shadow-sm border border-slate-200">
                                <input type="checkbox" id={`subtask-${i}`} checked={!!selectedSubtasks[i]} onChange={() => handleToggle(i)} className="h-5 w-5 rounded-md border-slate-300 text-blue-600 focus:ring-blue-500 mr-3 shrink-0 cursor-pointer" />
                                <label htmlFor={`subtask-${i}`} className="flex-1 text-slate-700 text-sm cursor-pointer">{sub}</label>
                            </div>
                        )) : <p className="text-slate-500 italic text-center py-6">The AI couldn't break down this task.</p>}
                    </div>
                )}
            </div>
            <div className="p-4 bg-slate-50 rounded-b-2xl flex justify-end space-x-3">
                <button onClick={closeModal} className="px-5 py-2 bg-slate-200 text-slate-800 font-semibold rounded-lg hover:bg-slate-300 transition-colors">Cancel</button>
                <button onClick={handleAdd} disabled={isLoading || !subtasks || subtasks.length === 0} className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed shadow-sm transition-colors">Add Selected</button>
            </div>
        </Modal>
    );
};

interface ToastNotificationProps { toast: ToastData; setToast: React.Dispatch<React.SetStateAction<ToastData>>; }
const ToastNotification: React.FC<ToastNotificationProps> = ({ toast, setToast }) => {
    useEffect(() => {
        if (toast.show) {
            const timer = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 4000); 
            return () => clearTimeout(timer);
        }
    }, [toast.show, setToast]);

    if (!toast.show) return null;

    const toastStyles: Record<ToastData['type'], { bg: string; iconColor: string; icon: React.ReactNode }> = {
        success: { bg: 'bg-green-600', iconColor: 'text-green-300', icon: ICONS.success },
        coach: { bg: 'bg-purple-600', iconColor: 'text-purple-300', icon: ICONS.coach },
        info: { bg: 'bg-sky-600', iconColor: 'text-sky-300', icon: ICONS.info },
        error: { bg: 'bg-red-600', iconColor: 'text-red-300', icon: ICONS.info }, 
    };

    const style = toastStyles[toast.type] || toastStyles.info;
    const position = toast.type === 'coach' ? 'top-5 right-5' : 'bottom-5 right-5';

    return (
        <div className={`fixed ${position} ${style.bg} text-white p-4 rounded-xl shadow-2xl z-[70] flex items-start max-w-sm transition-all duration-300 ease-in-out transform ${toast.show ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'} animate-fade-in-up`}>
             <div className={`shrink-0 mr-3 pt-0.5 ${style.iconColor}`}>{style.icon}</div>
             <div className="flex-grow text-sm font-medium">{toast.message}</div>
             <button onClick={() => setToast({ ...toast, show: false })} className={`ml-4 -mr-1 -mt-1 p-1 rounded-full hover:bg-black/20 focus:outline-none focus:ring-2 focus:ring-white/50 transition-colors`} aria-label="Close toast">
                {ICONS.close}
             </button>
        </div>
    );
};

const ApiKeyModal: React.FC<{ isOpen: boolean; closeModal: () => void; goToSettings: () => void; }> = ({ isOpen, closeModal, goToSettings }) => {
    return (
        <Modal isOpen={isOpen} closeModal={closeModal}>
            <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                    <h3 className="text-2xl font-bold text-slate-800 flex items-center gap-3"><span className="text-amber-500">{ICONS.settings}</span>API Key Required</h3>
                    <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 p-1 -mt-1 -mr-1 rounded-full hover:bg-slate-100 transition-colors" aria-label="Close">{ICONS.close}</button>
                </div>
                <div className="space-y-4 text-sm text-slate-600">
                    <p>Please enter your Gemini API key in Settings to use AI features.</p>
                    <p>You can get a free API key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-semibold hover:underline">Google AI Studio</a>.</p>
                </div>
            </div>
            <div className="p-4 bg-slate-50 rounded-b-2xl flex justify-end space-x-3">
                <button onClick={closeModal} className="px-5 py-2 bg-slate-200 text-slate-800 font-semibold rounded-lg hover:bg-slate-300 transition-colors">Cancel</button>
                <button onClick={goToSettings} className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm">Go to Settings</button>
            </div>
        </Modal>
    );
};


export default ApplicationLayout;