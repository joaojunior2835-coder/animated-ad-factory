// One capability-driven settings surface. Models/limits come from the backend;
// workspace wrappers retain their own prompt, references and confirmation flow.
export default function ModelSettings({ model, value, onChange, disabled=false, prefix='', image=false, reference=false }) {
  const select=(key,label,items,numeric=false,aria=label)=> <label className="field" key={key}>{label}<select aria-label={`${prefix} ${aria}`.trim()} value={value[key]} disabled={disabled||!items?.length} onChange={event=>onChange(key,numeric?Number(event.target.value):event.target.value)}>
    {!items?.some(item=>String(item.value??item)===String(value[key]))&&<option value={value[key]??''}>Choose a supported setting</option>}
    {items?.map(item=><option key={item.value??item} value={item.value??item}>{item.label??item}</option>)}
  </select></label>
  const quantities=model?.quantity?Array.from({length:model.quantity.max-model.quantity.min+1},(_,i)=>model.quantity.min+i):[]
  if(image)return <>{select('imageSize','Size',model?.imageSizes?.map(s=>({value:s.id,label:s.label})),false,'size')}{select('outputFormat','Format',model?.outputFormats?.map(v=>({value:v,label:v.toUpperCase()})),false,'format')}{select('quantity','Outputs',quantities.map(n=>({value:n,label:`Outputs: ${n}`})),true,'output quantity')}</>
  return <>{select('seconds','Duration (seconds)',model?.durations,true,'duration')}{select('resolution','Resolution',model?.resolutions,false,'resolution')}{select('aspectRatio','Aspect ratio',reference?model?.referenceAspects:model?.aspects,false,'aspect ratio')}{select('quantity','Outputs',quantities.map(n=>({value:n,label:`Outputs: ${n}`})),true,'output quantity')}{model?.audio&&<label className="cg-check"><input type="checkbox" disabled={disabled} checked={value.generateAudio===true} onChange={event=>onChange('generateAudio',event.target.checked)}/>Generate audio</label>}</>
}
