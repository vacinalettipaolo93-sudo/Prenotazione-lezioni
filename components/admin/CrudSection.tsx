
import React, { useState } from 'react';

interface CrudSectionProps<T extends { id: string }> {
    title: string;
    items: T[];
    setItems: (newItems: T[]) => void;
    renderItem: (item: T) => React.ReactNode;
    newItemFactory: () => T;
    renderEditForm: (item: T, setItem: (item: T) => void) => React.ReactNode;
}

function CrudSection<T extends { id: string }>({
    title, items, setItems, renderItem, newItemFactory, renderEditForm
}: CrudSectionProps<T>) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingItem, setEditingItem] = useState<T | null>(null);
    const [newItem, setNewItem] = useState<T>(newItemFactory());

    const handleAdd = () => {
        const name = (newItem as any).name;
        const value = (newItem as any).value;
        if (name === '' || (value !== undefined && value <= 0)) return;
        setItems([...items, newItem]);
        setNewItem(newItemFactory());
    };
    
    const handleEdit = (item: T) => {
        setEditingId(item.id);
        setEditingItem(item);
    }

    const handleSaveEdit = () => {
        if (!editingItem) return;
        setItems(items.map(item => item.id === editingId ? editingItem : item));
        setEditingId(null);
        setEditingItem(null);
    };

    const handleDelete = (id: string) => {
        if (window.confirm("Sei sicuro di voler eliminare questo elemento?")) {
            setItems(items.filter(item => item.id !== id));
        }
    };

    return (
        <div className="border border-gray-700 p-6 rounded-lg bg-gray-900/50">
            <h3 className="text-xl font-bold mb-4 text-white">{title}</h3>
            <div className="space-y-3 mb-6 min-h-[6rem]">
                {items.map(item => (
                    <div key={item.id} className="flex items-center gap-4 p-3 bg-gray-700 rounded-lg shadow-sm">
                        {editingId === item.id && editingItem ? (
                            <>
                                {renderEditForm(editingItem, setEditingItem)}
                                <button onClick={handleSaveEdit} className="text-green-400 font-semibold">Salva</button>
                                <button onClick={() => setEditingId(null)} className="text-gray-400">Annulla</button>
                            </>
                        ) : (
                            <>
                                <div className="flex-grow text-gray-200">{renderItem(item)}</div>
                                <button onClick={() => handleEdit(item)} className="text-blue-400 font-semibold">Modifica</button>
                                <button onClick={() => handleDelete(item.id)} className="text-red-400 font-semibold">Elimina</button>
                            </>
                        )}
                    </div>
                ))}
                 {items.length === 0 && <p className="text-gray-500 text-center py-4">Nessun elemento aggiunto.</p>}
            </div>
            <div className="border-t border-gray-700 pt-6">
                <h4 className="text-lg font-semibold mb-3 text-white">Aggiungi Nuovo</h4>
                <div className="flex items-center gap-4">
                    {renderEditForm(newItem, setNewItem)}
                    <button onClick={handleAdd} className="bg-emerald-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-emerald-700">Aggiungi</button>
                </div>
            </div>
        </div>
    );
}
export default CrudSection;
