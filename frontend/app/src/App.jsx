import { useState, useEffect } from 'react';

export default function Dashboard() {
  // 1. Estado para guardar os dados do back-end
  const [resumo, setResumo] = useState({
    total_entradas: 0,
    total_saidas: 0,
    saldo_atual: 0,
  });

  // Estados dos inputs
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [tipo, setTipo] = useState('saida'); 
  const [transacoes, setTransacoes] = useState([])
  // Estado para controlar o mês selecionado
  const [mes, setMes] = useState(new Date().getMonth()+1);
  const [ano,setAno] = useState(2026);

  // Função para salvar nova transação
  const handleSalvar = async (e) => {
    e.preventDefault();
    console.log("🚀 BOTÃO CLICADO! Tentando enviar:", { descricao, valor, tipo });

    const novaTransacao = {
      descricao,
      valor: Number(valor),
      tipo,
      categoria_id: 1 
    };

    try {
      await fetch('http://localhost:8000/transacoes/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(novaTransacao)
      });

      // Limpa os campos e recarrega os dados do dashboard
      setDescricao('');
      setValor('');
      carregarDashboard();
      carrregarTransacoes()
    } catch (error) {
      console.error("Erro ao salvar transação:", error);
    }

    
  };

  // Função que busca os dados na API
  const carregarDashboard = async () => {
    try {
      const response = await fetch(`http://localhost:8000/dashboard/?mes=${mes}&ano=${ano}`);
      const dados = await response.json();
      setResumo(dados);
    } catch (error) {
      console.error("Erro ao conectar com o back-end:", error);
    }
  };

  const deletarTransacao = async (idparaDeletar) =>{

    const confirmou = window.alert("Tem certeza que deseja excluir esta transacao?")

      if(!confirmou) return

    await fetch(`http://localhost:8000/transacoes/${idparaDeletar}`,{
      method: 'DELETE'
    })

    carregarDashboard()
    carrregarTransacoes()
  }

  useEffect(() => {
    carregarDashboard();
    carrregarTransacoes();
  }, [mes,ano]);

  const formatarMoeda = (valor) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
  };

  const carrregarTransacoes = async()=>{
    const response = await fetch('http://localhost:8000/transacoes/',)

    const dados = await response.json()

    setTransacoes(dados)
  }

  return (
  
    <div className="p-6 max-w-6xl mx-auto bg-gray-50 min-h-screen text-gray-900">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-8 border-b border-gray-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Casal <span className="text-indigo-600">finance</span></h1>
          <p className="text-sm text-gray-500 mt-1">Resumo do mês</p>
        </div>

        {/* Seletor de Mês */}
        <div className='flex gap-4 mbb-6 items-center'>
      </div>
      <label  className='block text-sm font-medium text-gray-700 mb-1'>Mês</label>
      <select value={mes} onChange={(e) => setMes(Number(e.target.value))}
        className='p-2 border rounded-md bg-white shadow-sm'>
          <option value={1}>Janeiro</option>
      <option value={2}>Fevereiro</option>
      <option value={3}>Março</option>
      <option value={4}>Abril</option>
      <option value={5}>Maio</option>
      <option value={6}>Junho</option>
      <option value={7}>Julho</option>
      <option value={8}>Agosto</option>
      <option value={9}>Setembro</option>
      <option value={10}>Outubro</option>
      <option value={11}>Novembro</option>
      <option value={12}>Dezembro</option>
        </select>
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 mb-1'>Ano</label>
          <select value={ano}
          onChange={(e)=> setAno(Number(e.target.value))}
          className='p-2 border rounded-md bg-white shadow-sm'>
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
            <option value={2027}>2027</option>
          </select>
        </div>

      {/* Formulário de Cadastro Rápido */}
      <form onSubmit={handleSalvar} className="bg-white p-5 rounded-xl border border-gray-200 mb-6 flex gap-4 items-end shadow-xs">
        
        {/* Campo Descrição */}
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-semibold text-gray-500 uppercase">Categoria</label>
          <input 
            type="text"
            placeholder="Ex: Mercado, Salário..."
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />
        </div>

        {/* Campo Valor */}
        <div className="flex flex-col gap-1 w-32">
          <label className="text-xs font-semibold text-gray-500 uppercase">Valor</label>
          <input 
            type="number"
            step="0.01"
            placeholder="0,00"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />
        </div>

        {/* Campo Tipo */}
        <div className="flex flex-col gap-1 w-36">
          <label className="text-xs font-semibold text-gray-500 uppercase">Tipo</label>
          <select 
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-gray-700"
          >
            <option value="saida">▼ Saída</option>
            <option value="entrada">▲ Entrada</option>
          </select>
        </div>

        {/* Botão de Enviar */}
        <button 
          type="submit"
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm px-5 py-2 rounded-lg transition-colors h-[38px]"
        >
          Salvar
        </button>

      </form>

      {/* Grid de Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* CARD 1: ENTRADAS */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Total Entradas</div>
          <div className="text-3xl font-semibold text-emerald-600">
            {formatarMoeda(resumo.total_entradas)}
          </div>
        </div>

        {/* CARD 2: SAÍDAS */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Total Saídas</div>
          <div className="text-3xl font-semibold text-rose-600">
            {formatarMoeda(resumo.total_saidas)}
          </div>
        </div>

        {/* CARD 3: SALDO ATUAL */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Saldo Disponível</div>
          <div className={`text-3xl font-semibold ${resumo.saldo_atual < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {formatarMoeda(resumo.saldo_atual)}
          </div>
        </div>

        <div className='mt-8 bg-white p-6 rounded-lg shadow-sm border border-gray-100'>
          <h3 className='text-lg font-semibold text-gray-800 mb-4'>
            Histórico de Transações
          </h3>
            {transacoes.length === 0 ? (
              <p className='text-gray-500 text-sm'>Nenhuma transação cadastrada ainda.</p>
                ) : (
        <div className='overflow-x-auto'>
          <table className='w-full text-left border-collapse'>
            <thead>
              <tr className='border-b border-gray-200 text-sm text-gray-500'>
                <th className='pb-3 font-medium'>Descrição</th>
                <th className='pb-3 font-medium'>Tipo</th>
                 <th className='pb-3 font-medium'>Valor</th>
              </tr>
            </thead>
                    <tbody className="divide-y divide-gray-100">
              {transacoes.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="py-3 text-gray-800">{item.descricao}</td>
                  <td className="py-3">
                    <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                      item.tipo === 'entrada' 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {item.tipo}
                    </span>
                  </td>
                  <td className='py-3 font-medium text-gray-800'>
                    R$ {Number(item.valor).toFixed(2)}
                  </td>
                  <td className='py-3 text-right'>
                    <button onClick={()=>deletarTransacao(item.id)} className='text-red-500 hover:text-red-700 text-s, font-medium'>
                      Exluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
)}
        </div>

      </div>
    </div>

  );
}