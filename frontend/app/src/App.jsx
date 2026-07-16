import React, { useState } from 'react'

function App() {
  // Dados falsos (mock) apenas para testarmos o visual da lista
  const [categorias, setCategorias] = useState([
    { id: 1, nome: "Moradia", pai_id: null },
    { id: 2, nome: "Aluguel", pai_id: 1 },
    { id: 3, nome: "Internet", pai_id: 1 },
    { id: 4, nome: "Alimentação", pai_id: null },
    { id: 5, nome: "Supermercado", pai_id: 4 },
  ])

  // Estados para controlar os campos do formulário
  const [nome, setNome] = useState("")
  const [categoriaPai, setCategoriaPai] = useState("")

  const lidarComEnvio = (e) => {
    e.preventDefault()
    if (!nome) return
    
    // Por enquanto, apenas simula a adição na lista para vermos o visual funcionar
    const nova = {
      id: Date.now(),
      nome: nome,
      pai_id: categoriaPai ? Number(categoriaPai) : null
    }
    
    setCategorias([...categorias, nova])
    setNome("")
    setCategoriaPai("")
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      {/* Cabeçalho Minimalista */}
      <header className="bg-white border-b border-gray-100 py-6 px-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-xl font-bold tracking-tight text-gray-900">Nossa Gestão Financeira</h1>
          <p className="text-xs text-gray-500 mt-0.5">Controle simples, moderno e direto ao ponto.</p>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="max-w-6xl mx-auto p-8 grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* COLUNA 1: Formulário de Cadastro (Ocupa 1 coluna) */}
        <section className="bg-white p-6 rounded-2xl border border-gray-100 h-fit">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Nova Categoria</h2>
          
          <form onSubmit={lidarComEnvio} className="space-y-4">
            {/* Campo Nome */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Nome da Categoria
              </label>
              <input 
                type="text" 
                placeholder="Ex: Transporte, Luz, Assinaturas"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:bg-white transition-all"
              />
            </div>

            {/* Campo Categoria Pai */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Categoria Pai (Subcategoria de...)
              </label>
              <select 
                value={categoriaPai}
                onChange={(e) => setCategoriaPai(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:bg-white transition-all"
              >
                <option value="">Nenhuma (Esta será uma categoria principal)</option>
                {/* Mostra apenas as categorias principais na seleção */}
                {categorias.filter(c => !c.pai_id).map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.nome}</option>
                ))}
              </select>
            </div>

            {/* Botão */}
            <button 
              type="submit"
              className="w-full bg-gray-900 hover:bg-gray-800 text-white font-medium py-2.5 px-4 rounded-xl text-sm transition-all duration-200 mt-2"
            >
              Criar Categoria
            </button>
          </form>
        </section>

        {/* COLUNA 2: Lista de Categorias (Ocupa 2 colunas) */}
        <section className="bg-white p-6 rounded-2xl border border-gray-100 md:col-span-2">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 font-sans">Suas Categorias</h2>
          
          <div className="space-y-4">
            {/* Filtramos apenas as categorias que não têm pai (as principais) */}
            {categorias.filter(c => !c.pai_id).map(categoriaPrincipal => {
              // Buscamos as subcategorias que pertencem a esta categoria principal
              const filhas = categorias.filter(c => c.pai_id === categoriaPrincipal.id)

              return (
                <div key={categoriaPrincipal.id} className="border border-gray-100 rounded-xl p-4 bg-gray-50/50">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📁</span>
                    <span className="font-semibold text-gray-800">{categoriaPrincipal.nome}</span>
                  </div>
                  
                  {/* Se existirem subcategorias, mostramos elas recuadas para dentro */}
                  {filhas.length > 0 && (
                    <div className="mt-2 ml-6 pl-4 border-l border-gray-200 space-y-2">
                      {filhas.map(filha => (
                        <div key={filha.id} className="flex items-center gap-2 text-sm text-gray-600">
                          <span>↳ 🏷️</span>
                          <span>{filha.nome}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

      </main>
    </div>
  )
}

export default App