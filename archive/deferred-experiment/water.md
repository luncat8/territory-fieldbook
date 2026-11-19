start at afb9d6e8f2a23c1132e3262a024a9e1c28ede009
and make separate test html

### improve water and humidity

humidity spawn/despawn = f( water amount in cell, 1/'water grouping demand' )
humidity diffuse

water move by gradient of heightmap and gradient of 'water grouping demand'  - another diffusion field that spread from existing water and fade over time.  this is important to form rivers and lakes, i think it is like autocorelate function that will more actively group water together instead of form thin layer over hills.
 need good think about it, how make rain mostly above rivers without constant rain above sea and without thin layer of water that will cover all land and slowly move. probably  'water grouping demand' should be big when water move in big speed and big amount.
probably better firstly  separate test html because this need more headless and visual testing


Design reasoning

The model has four fields: terrain h, water depth w, humidity H, and grouping demand G. The main rules are:

    Flow: Water moves downhill on the surface h + w - β·G. Because G lowers the potential, water is pulled toward higher grouping, which is the self-reinforcing channel effect you described.
    Grouping: G is sourced by flux F (how much water moved this step), diffuses a little, and decays. Thin, slow sheets produce little flux, so they never build G.
    Evaporation: E = k·w / (1 + c·G). Shallow water on hills evaporates freely, while water in a grouped river evaporates less. This matches your f(water, 1/G) idea.
    Humidity: H diffuses and slowly leaks away.
    Rain: R = rate · max(0, H − threshold) · G/(G + K). Rain only falls where G is high, so it concentrates over rivers. Over the sea, G stays near zero, so there is almost no rain even though humidity is high.
    Thin films: Water below a thickness threshold infiltrates, so sheets cannot spread across all land.
    Sea: Sea cells are held at sea level as a fixed reservoir and sink.

The main risk is runaway. If β or the source is too strong, all water collapses into one channel. If the decay is too strong, nothing groups. The sliders let you find the balance.