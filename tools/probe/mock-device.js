/* Perangkat palsu untuk mencoba halaman probe tanpa keyboard.
   Aktif hanya bila alamat halaman memuat ?mock */
(()=>{
  if(!/[?&]mock\b/.test(location.search))return;

  const ROWS=6, COLS=16, LAYERS=4, LAYER_BYTES=ROWS*COLS*2;
  const keymap=new Uint8Array(LAYERS*LAYER_BYTES);
  const setKey=(layer,row,col,code)=>{
    const o=layer*LAYER_BYTES+(row*COLS+col)*2;
    keymap[o]=code>>8;keymap[o+1]=code&0xFF;
  };
  for(let l=0;l<LAYERS;l++)for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)setKey(l,r,c,l===0?0x04+((r*COLS+c)%26):0x0001);
  [0x7E01,0x7E02,0x7E03,0x7E00,0x7E04].forEach((code,i)=>setKey(1,1,1+i,code));

  const macro=new Uint8Array(1024);
  macro.set([1,2,0xE0, 1,1,0x06, 1,3,0xE0, 0]);   /* tahan Ctrl, tap C, lepas Ctrl */

  const started=Date.now();
  const sent=[];

  function handle(req){
    const r=new Uint8Array(32);
    r.set(req);
    switch(req[0]){
      case 0x01: r[1]=0x00;r[2]=0x0C;break;
      case 0x02:
        if(req[1]===0x01){const up=(Date.now()-started)>>>0;r[2]=up>>>24;r[3]=(up>>>16)&255;r[4]=(up>>>8)&255;r[5]=up&255;}
        else if(req[1]===0x02){r[2]=0;r[3]=0;}
        else if(req[1]===0x03){
          const odd=Math.floor(Date.now()/1000)%2===1;
          if(odd){r[2+0*2]=0x00;r[3+0*2]=0x02;r[2+3*2]=0x80;r[3+3*2]=0x00;}   /* 0,1 dan 3,15 */
        }else r[0]=0xFF;
        break;
      case 0x11: r[1]=LAYERS;break;
      case 0x0C: r[1]=16;break;
      case 0x0D: r[1]=0x04;r[2]=0x00;break;
      case 0x12:{const off=(req[1]<<8)|req[2];r.set(keymap.subarray(off,off+req[3]),4);break;}
      case 0x0E:{const off=(req[1]<<8)|req[2];r.set(macro.subarray(off,off+req[3]),4);break;}
      case 0x08:
        if(req[1]===3){
          if(req[2]===1)r[3]=128;else if(req[2]===2)r[3]=12;else if(req[2]===3)r[3]=128;else if(req[2]===4){r[3]=10;r[4]=255;}else r[0]=0xFF;
        }else r[0]=0xFF;
        break;
      default: r[0]=0xFF;   /* termasuk 0x14: encoder dianggap tidak didukung */
    }
    return r;
  }

  const device=Object.assign(new EventTarget(),{
    vendorId:0x36B0,productId:0x3077,productName:'Gaming keyboard (simulasi)',opened:false,
    collections:[{usagePage:0xFF60,usage:0x61}],
    async open(){device.opened=true;},
    async close(){device.opened=false;},
    async sendReport(id,data){
      sent.push(data[0]);
      const res=handle(data);
      setTimeout(()=>{
        const ev=new Event('inputreport');
        ev.reportId=0;ev.data=new DataView(res.buffer);
        device.dispatchEvent(ev);
      },5);
    }
  });

  Object.defineProperty(navigator,'hid',{configurable:true,value:{
    requestDevice:async()=>[device],
    getDevices:async()=>[device],
    addEventListener(){},
    removeEventListener(){}
  }});
  window.__mock={device,sent};
})();
