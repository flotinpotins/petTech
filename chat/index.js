const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const closeBtn = document.getElementById('close-btn');

function scrollToBottom(){
	messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMessage(role, text, options={}){
	const row = document.createElement('div');
	row.className = `msg ${role}`;
	const avatar = document.createElement('div');
	avatar.className = 'avatar';
	avatar.textContent = role === 'user' ? '我' : '宠';
	const bubble = document.createElement('div');
	bubble.className = 'bubble';
	bubble.textContent = text || '';
	if(options.thinking){ bubble.classList.add('thinking'); }
	row.appendChild(avatar);
	row.appendChild(bubble);
	messagesEl.appendChild(row);
	scrollToBottom();
	return bubble;
}

function setSending(sending){
	sendBtn.disabled = sending;
	inputEl.disabled = sending;
}

async function sendCurrent(){
	const text = inputEl.value.trim();
	if(!text) return;
	appendMessage('user', text);
	inputEl.value='';
	setSending(true);
	const botBubble = appendMessage('bot', '…', { thinking:true });
	let accumulated = '';
	const off = window.chatAPI.onDelta((payload)=>{
		if(payload && payload.error){
			botBubble.classList.remove('thinking');
			botBubble.textContent = `错误：${payload.error}`;
			setSending(false);
			off();
			return;
		}
		if(payload && payload.delta){
			botBubble.classList.remove('thinking');
			accumulated += payload.delta;
			botBubble.textContent = accumulated;
			scrollToBottom();
		}
		if(payload && payload.done){
			setSending(false);
			off();
		}
	});
	try{
		await window.chatAPI.send(text);
	}catch(_){
		// errors are surfaced via onDelta
	}
}

function handleKey(e){
	if(e.key==='Enter' && !e.shiftKey){
		e.preventDefault();
		sendCurrent();
	}
}

async function maybeShowGreeting(){
	try{
		const { greeting } = await window.chatAPI.getGreeting();
		if(greeting){
			appendMessage('bot', greeting);
		}
	}catch(_){
		// ignore
	}
}

function init(){
	sendBtn.addEventListener('click', sendCurrent);
	inputEl.addEventListener('keydown', handleKey);
	closeBtn.addEventListener('click', ()=>{ window.close(); });
	maybeShowGreeting();
}

if(document.readyState==='loading'){
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}


