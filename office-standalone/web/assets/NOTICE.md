# Office frontend assets

Selected assets were copied from NosytLabs/agent-office, commit
3479b64a97f43a1251aef5946444ac36babea52a. Original notices are retained in
LICENSE, PIXEL-AGENTS-LICENSE.txt, and ATTRIBUTION.md beside this file.

Character sheets char_0.png through char_4.png are the project's existing
Pixel Agents adaptation, credited to Pablo De Lucca under MIT. The upstream
project credits JIK-A-4 / Metro City for character artwork.

studio-atlas.png, utilities-atlas.png, and decor-atlas.png are the original
project's OpenAI-generated furniture atlases dated 2026-10-03. Their source
pixels were copied without alteration.

meeting-atlas.png and specialty-atlas.png were generated for the local asset
collection from written prompts and the user's requested visual direction.
They are copied from assets/generated without alteration. Their prompt and
generation records remain in that asset collection.

hermes-hq-office.png is new office background artwork generated with the
built-in image generation tool on 2026-10-05, using the user's supplied
reference. Its generation prompt is retained in office-room.prompt.md.
The background contains furniture only. Labels and status are live UI
components rather than text baked into the artwork.

Character presence represents
the real Hermes bot profiles returned by the monitoring server. A stable
sorted profile ID assigns one of the five visual character sheets, with
distinct characters for the first five profiles. All bot workstations share
one office floor, including the meeting, lounge, and server areas.
Profile status, session metadata, and activity come from the monitoring API;
the scene does not invent work or task progress.
