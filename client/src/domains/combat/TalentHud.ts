import type { CombatSession } from './CombatSession'
import { talentIcon } from './TalentIcons'

/** Small persistent reminder of the actual equipped run talents; no separate state. */
export class TalentHud {
  private readonly root=document.createElement('div')
  private readonly off:()=>void
  constructor(private readonly session:CombatSession){
    this.root.className='talent-hud'
    this.root.setAttribute('aria-label','本局天赋')
    document.body.append(this.root)
    this.off=session.bus.on('reward_selected',()=>this.refresh())
    this.refresh()
  }
  private refresh():void{
    const owned=this.session.talents.owned
    this.root.hidden=!owned.length
    this.root.replaceChildren()
    const label=document.createElement('span');label.className='talent-hud-label';label.textContent='本局天赋 '+owned.length+'/'+(this.session.cfg.talents?.maxOwned??0)
    const icons=document.createElement('div');icons.className='talent-hud-icons'
    for(const reward of owned){const item=document.createElement('button');item.type='button';item.innerHTML=talentIcon(reward.talent!.kind);item.setAttribute('aria-label',reward.name+'：'+reward.description);const tip=document.createElement('span');tip.className='talent-hud-tip';const name=document.createElement('strong');name.textContent=reward.name;const description=document.createElement('span');description.textContent=reward.description;tip.append(name,description);item.append(tip);icons.append(item)}
    this.root.append(label,icons)
  }
  destroy():void{this.off();this.root.remove()}
}
