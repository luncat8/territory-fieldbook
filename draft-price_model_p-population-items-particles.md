
field remain for prices demand. actual objects are particles with properties: amount, owner, actual price at this moment (factories output self price + transportation cost )


make this settings as default engine:

all items (goods, population) are particles.
particles move by price (demand) gradient.
particles has own actual price (resources+work cost from factory), than price rise as particle move on map with transportation cost and small deplete with time (food faster deplete, ore dont deplete).
finally item come to buyer storage, difference of item.price with what buyer pay is profit for factory.

in this mode map view items render actual particles with item.price ~ color, amount ~ light.
do not move particles < some minimal amount but combine at spawn. i suggest use cell to store float  until amount for particle spawn. choose some good amount of items in 1 particle according to performance and settings