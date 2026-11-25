export const services = [
  { id: 'gel-pe', name: 'Esmaltação em gel pé', cents: 3000, icon: 'sparkles', description: 'Cor uniforme e brilho duradouro para os pés.' },
  { id: 'mao-pe', name: 'Mão e pé', cents: 6000, icon: 'hand', description: 'Cuidado completo, das mãos aos pés.' },
  { id: 'posticas', name: 'Postiças realistas', cents: 6500, icon: 'flower', description: 'Alongamento de aparência natural e acabamento delicado.' },
  { id: 'banho-gel', name: 'Banho de gel', cents: 10000, icon: 'drop', description: 'Uma camada de gel para proteger e reforçar as unhas naturais.' },
  { id: 'unhas-gel', name: 'Unhas de gel', cents: 12000, icon: 'diamond', description: 'Alongamento em gel, com formato escolhido por você.' },
  { id: 'acessorios', name: 'Acessórios', cents: 200, icon: 'star', description: 'Adicione um toque de brilho ao seu atendimento.', extra: true },
  { id: 'arte-3d', name: 'Arte em 3D', cents: null, icon: 'flower', description: 'Detalhes em relevo, criados sob consulta.' },
  { id: 'reposicao', name: 'Reposição', cents: 1000, icon: 'plus', description: 'Reposição de uma unha para completar o visual.' },
  { id: 'remocao', name: 'Remoção', cents: 3000, icon: 'drop', description: 'Retirada cuidadosa do gel ou alongamento.' },
];

export const whatsapp = 'https://wa.me/5571988553209';
export const money = (cents) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
