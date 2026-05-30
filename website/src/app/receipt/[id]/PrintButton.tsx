"use client";

export function PrintButton() {
    return (
        <button
            onClick={() => window.print()}
            className="print:hidden inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors text-sm"
        >
            🖨️ Imprimer / Télécharger PDF
        </button>
    );
}
