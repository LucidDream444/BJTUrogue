import type { CombatSession } from './CombatSession'
import { talentIcon } from './TalentIcons'
import './RewardPanel.css'

/** Product choice UI. All effects/descriptions come from the actual runtime reward catalog. */
export class RewardPanel {
  private readonly root=document.createElement('div')
  private readonly off:(()=>void)[]=[]
  private activeRoom:string|null=null
  private locked=false
  private previousFocus:HTMLElement|null=null
  private readonly onKey=(event:KeyboardEvent):void=>{
    if(this.root.hidden)return
    if(['Digit1','Digit2','Digit3','Numpad1','Numpad2','Numpad3','KeyR','Tab','Escape','Space','Enter'].includes(event.code)){
      event.stopImmediatePropagation()
      if(event.code!=='Enter')event.preventDefault()
    }
    if(event.repeat)return
    if(event.code==='Tab'){
      const buttons=[...this.root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const index=buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(index+(event.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus()
    }else if(event.code==='KeyR')this.reroll()
    else{
      const index=['Digit1','Digit2','Digit3'].indexOf(event.code)
      const number=index>=0?index:['Numpad1','Numpad2','Numpad3'].indexOf(event.code)
      const reward=this.session.rewards.offered[number]
      if(reward)this.select(reward.id)
    }
  }
  constructor(private readonly session:CombatSession){
    this.root.className='talent-reward d1-reward'
    this.root.hidden=true
    this.root.setAttribute('role','dialog')
    this.root.setAttribute('aria-modal','true')
    this.root.setAttribute('aria-labelledby','talent-reward-title')
    this.root.addEventListener('pointerdown',(event)=>event.stopPropagation())
    document.body.append(this.root)
    document.addEventListener('keydown',this.onKey,true)
    this.off.push(session.bus.on('reward_offered',(event)=>this.show(event.roomId)),session.bus.on('reward_finished',()=>this.hide()))
  }
  private select(id:string):void{
    if(this.locked||this.activeRoom===null||this.session.rewards.roomId!==this.activeRoom)return
    this.locked=true
    this.root.querySelectorAll<HTMLButtonElement>('button').forEach((button)=>button.disabled=true)
    if(!this.session.choose(id)){this.locked=false;this.root.querySelectorAll<HTMLButtonElement>('button').forEach((button)=>button.disabled=false)}
  }
  private reroll():void{if(!this.locked)this.session.rerollRewards()}
  private show(roomId:string):void{
    const {rewards,talents}=this.session,options=rewards.offered
    if(!options.length){this.hide();return}
    if(this.activeRoom===null)this.previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null
    this.activeRoom=roomId;this.locked=false;this.root.hidden=false
    this.root.dataset.roomId=roomId
    this.root.dataset.owned=String(talents.owned.length)
    this.root.replaceChildren()
    const sheet=document.createElement('section');sheet.className='tr-sheet'
    const header=document.createElement('header');header.className='tr-header'
    const eyebrow=document.createElement('div');eyebrow.className='tr-eyebrow';eyebrow.textContent='AFTER CLASS / TALENT SELECTION'
    const title=document.createElement('h1');title.id='talent-reward-title';title.textContent='下一枪，换种可能。'
    const subtitle=document.createElement('p');subtitle.textContent='选择一个天赋 · 立即生效 · 本局持续保留'
    const location=document.createElement('div');location.className='tr-location';location.innerHTML='<i></i><span></span><small>战斗已暂停</small>';location.querySelector('span')!.textContent=this.session.rewardLocation
    header.append(eyebrow,title,subtitle,location)
    const choices=document.createElement('div');choices.className='tr-choices'
    const ownedKinds=new Set(talents.owned.map((r)=>r.talent!.kind))
    options.forEach((reward,index)=>{
      const button=document.createElement('button');button.type='button';button.className='tr-card';button.dataset.rewardId=reward.id;button.dataset.category=reward.category??'utility'
      const category=reward.category==='survival'?'生存与续航':reward.category==='firepower'?'攻击与连锁':'技能与辅助'
      const top=document.createElement('div');top.className='tr-card-top';top.innerHTML='<span></span><kbd></kbd>';top.querySelector('span')!.textContent=category;top.querySelector('kbd')!.textContent=String(index+1)
      const art=document.createElement('div');art.className='tr-card-art';art.innerHTML='<span class="tr-orbit tr-orbit-one"></span><span class="tr-orbit tr-orbit-two"></span>'+talentIcon(reward.talent?.kind)
      const copy=document.createElement('div');copy.className='tr-card-copy'
      const name=document.createElement('h2');name.textContent=reward.name
      const headline=document.createElement('div');headline.className='tr-headline';headline.textContent=reward.headline??'本局新增能力'
      const description=document.createElement('p');description.className='tr-description';description.textContent=reward.description
      const synergy=document.createElement('div');synergy.className='tr-synergy'
      const partners=talents.owned.filter((owned)=>reward.talent?.synergy.includes(owned.talent!.kind)||owned.talent?.synergy.includes(reward.talent!.kind))
      const isLinked=reward.talent?.synergy.some((kind)=>ownedKinds.has(kind))||partners.length>0
      synergy.classList.toggle('is-linked',isLinked)
      synergy.textContent=isLinked?'可联动 · '+partners.slice(0,2).map((r)=>r.name).join(' / '):'独立生效 · 无需前置天赋'
      const action=document.createElement('div');action.className='tr-select';action.innerHTML='<span>选择此天赋</span><b>↗</b>'
      copy.append(name,headline,description,synergy);button.append(top,art,copy,action)
      button.addEventListener('click',()=>this.select(reward.id));choices.append(button)
    })
    const build=document.createElement('section');build.className='tr-build'
    const buildLabel=document.createElement('div');buildLabel.className='tr-build-label';buildLabel.textContent='本局天赋 '+talents.owned.length+' / '+(this.session.cfg.talents?.maxOwned??8)
    const chips=document.createElement('div');chips.className='tr-chips'
    if(!talents.owned.length){const empty=document.createElement('span');empty.className='tr-empty';empty.textContent='从这一张开始，组合你的玩法。';chips.append(empty)}
    for(const reward of talents.owned){const chip=document.createElement('span');chip.className='tr-chip';chip.innerHTML=talentIcon(reward.talent!.kind);chip.append(document.createTextNode(reward.name));chips.append(chip)}
    build.append(buildLabel,chips)
    const footer=document.createElement('footer');footer.className='tr-footer'
    const hint=document.createElement('span');hint.textContent='点击卡片，或按 1 / 2 / 3 选择'
    const refresh=document.createElement('button');refresh.type='button';refresh.className='tr-refresh';refresh.dataset.action='reroll';refresh.disabled=rewards.rerollsLeft<=0;refresh.innerHTML='<kbd>R</kbd><span></span><b>↻</b>';refresh.querySelector('span')!.textContent='换一组 · 剩余 '+rewards.rerollsLeft+' 次';refresh.addEventListener('click',()=>this.reroll())
    footer.append(hint,refresh);sheet.append(header,choices,build,footer);this.root.append(sheet)
    choices.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true})
  }
  private hide():void{
    this.root.hidden=true;this.activeRoom=null;this.root.replaceChildren();this.locked=false
    if(this.previousFocus?.isConnected)this.previousFocus.focus({preventScroll:true})
    this.previousFocus=null
  }
  destroy():void{for(const off of this.off)off();document.removeEventListener('keydown',this.onKey,true);this.root.remove()}
}
