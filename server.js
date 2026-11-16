const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const D=path.join(__dirname,'data'),F=D+'/data.json',U=D+'/uploads';
fs.mkdirSync(U,{recursive:true});
let db=fs.existsSync(F)?JSON.parse(fs.readFileSync(F)):{stages:['Rover','Utalshon','Najdak','Gruntovka','Lak'],users:[{u:'shoxi',p:'shoxi07',role:'admin'}],cats:[],orders:[],seq:0};
db.workers=db.workers||[];db.cap=db.cap||[];
const save=()=>fs.writeFileSync(F,JSON.stringify(db));
const tokens={},id=()=>crypto.randomBytes(5).toString('hex');
const today=()=>new Date(Date.now()+5*36e5).toISOString().slice(0,10);
http.createServer((req,res)=>{
const url=req.url.split('?')[0];
if(url.startsWith('/uploads/')){const f=path.join(U,path.basename(url));if(fs.existsSync(f)){res.writeHead(200,{'Content-Type':'image/jpeg'});return fs.createReadStream(f).pipe(res)}res.writeHead(404);return res.end()}
if(url==='/qrcode.min.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(fs.readFileSync(path.join(__dirname,'qrcode.min.js')))}
if(req.method==='GET'&&!url.startsWith('/api')){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'index.html')))}
let b='';req.on('data',c=>b+=c);req.on('end',()=>{
let j={};try{j=JSON.parse(b||'{}')}catch(e){}
const out=(o,c=200)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
if(url==='/api/login'){const u=db.users.find(x=>x.u===j.u&&x.p===j.p);if(!u)return out({e:'Login yoki parol xato'},401);const t=id()+id();tokens[t]=u;return out({t,role:u.role,u:u.u})}
const me=tokens[req.headers['x-token']];if(!me)return out({e:'auth'},401);
if(url==='/api/state')return out({stages:db.stages,cats:db.cats,orders:db.orders,workers:db.workers,cap:db.cap,role:me.role,users:me.role==='admin'?db.users:[]});
if(url==='/api/adv'){const o=db.orders.find(x=>x.id===j.id);if(!o)return out({e:'Zakaz topilmadi'},404);if(o.stage>=db.stages.length)return out({e:'Zakaz allaqachon tayyor',o});o.stage++;o.hist.push({s:o.stage,t:Date.now(),by:me.u});if(o.stage>=db.stages.length)o.done=today();save();return out({o})}
if(me.role!=='admin')return out({e:'Ruxsat yo\'q'},403);
const c=db.cats.find(x=>x.id===j.c),m=c&&c.models.find(x=>x.id===j.m);
switch(j.a){
case'stages':db.stages=j.v;break;
case'user+':if(db.users.find(x=>x.u===j.u))return out({e:'Bunday login bor'});db.users.push({u:j.u,p:j.p,role:'staff'});break;
case'user-':db.users=db.users.filter(x=>x.u!==j.u||x.role==='admin');break;
case'w+':db.workers.push({id:id(),name:j.n,line:-1,help:-1});break;
case'w-':db.workers=db.workers.filter(x=>x.id!==j.w);break;
case'wset':{const w=db.workers.find(x=>x.id===j.w);w.line=+j.line;w.help=+j.help;break}
case'cap':db.cap=j.v;break;
case'auto':db.workers.filter(w=>w.line<0).forEach(w=>{const i=db.stages.findIndex((_,k)=>db.workers.filter(x=>x.line===k).length<(db.cap[k]||0));if(i>=0)w.line=i});break;
case'cat+':db.cats.push({id:id(),name:j.n,models:[]});break;
case'cat-':db.cats=db.cats.filter(x=>x.id!==j.c);break;
case'model+':c.models.push({id:id(),name:j.n,imgs:[]});break;
case'model-':c.models=c.models.filter(x=>x.id!==j.m);break;
case'img+':{const n='/uploads/'+id()+'.jpg';fs.writeFileSync(path.join(U,path.basename(n)),Buffer.from(j.d.split(',')[1],'base64'));m.imgs.push(n);break}
case'img-':m.imgs=m.imgs.filter(x=>x!==j.i);break;
case'ord+':db.orders.push({id:id(),no:++db.seq,client:j.client,cat:c?c.name:'',model:m?m.name:j.model||'',qty:j.qty,note:j.note,imgs:m?[...m.imgs]:[],stage:+j.stage||0,date:today(),hist:[]});break;
case'ord-':db.orders=db.orders.filter(x=>x.id!==j.id);break;
}
save();out({ok:1})});
}).listen(process.env.PORT||3000,()=>console.log('Ishga tushdi: http://localhost:'+(process.env.PORT||3000)));
