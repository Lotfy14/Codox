import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

async function crop(examDir, pageNumber, box, outFile) {
  const manifest = JSON.parse(await readFile(path.join(examDir, 'exam.json'), 'utf8'));
  const page = manifest.pages.find((entry) => entry.index === pageNumber - 1);
  if (!page) {
    throw new Error(`Page ${pageNumber} not found in manifest`);
  }
  const [ymin, xmin, ymax, xmax] = box;
  const left = Math.round((xmin / 1000) * page.width);
  const top = Math.round((ymin / 1000) * page.height);
  const width = Math.max(1, Math.min(page.width - left, Math.round(((xmax - xmin) / 1000) * page.width)));
  const height = Math.max(1, Math.min(page.height - top, Math.round(((ymax - ymin) / 1000) * page.height)));

  const outPath = path.join(examDir, outFile);
  const source = await readFile(path.join(examDir, page.file));
  const cropped = await sharp(source)
    .extract({ left, top, width, height })
    .jpeg({ quality: 85 })
    .toBuffer();
  await writeFile(outPath, cropped);
  console.log(`Cropped and saved: ${outPath} (page ${pageNumber}, ${width}x${height} at ${left},${top})`);
}

async function refinePaper1() {
  const examSlug = '0610-m20-qp-12';
  const examDir = path.resolve(`agent-conversion/output/2020 Feb-March/${examSlug}`);
  const examJsonPath = path.join(examDir, 'exam.json');
  const manifest = JSON.parse(await readFile(examJsonPath, 'utf8'));

  manifest.producedBy = 'gemini-3.5-flash';

  // We will define crops we want to perform
  const crops = [
    { id: 'fig-01', page: 2, box: [282, 115, 410, 400], file: 'images/fig-01.jpg' },
    { id: 'fig-02', page: 3, box: [98, 380, 200, 620], file: 'images/fig-02.jpg' },
    { id: 'fig-03', page: 3, box: [535, 115, 700, 680], file: 'images/fig-03.jpg' },
    { id: 'fig-04', page: 4, box: [350, 130, 610, 830], file: 'images/fig-04.jpg' },
    { id: 'fig-05', page: 5, box: [100, 115, 375, 810], file: 'images/fig-05.jpg' },
    { id: 'fig-06', page: 5, box: [430, 240, 530, 760], file: 'images/fig-06.jpg' },
    { id: 'fig-07', page: 6, box: [165, 110, 250, 520], file: 'images/fig-07.jpg' },
    { id: 'fig-08', page: 7, box: [100, 115, 295, 860], file: 'images/fig-08.jpg' },
    { id: 'fig-09', page: 7, box: [345, 115, 690, 580], file: 'images/fig-09.jpg' },
    { id: 'fig-10', page: 8, box: [100, 115, 520, 660], file: 'images/fig-10.jpg' },
    { id: 'fig-11', page: 8, box: [590, 100, 820, 890], file: 'images/fig-11.jpg' },
    { id: 'fig-12', page: 9, box: [100, 350, 345, 640], file: 'images/fig-12.jpg' },
    { id: 'fig-13', page: 9, box: [635, 115, 765, 670], file: 'images/fig-13.jpg' },
    { id: 'fig-14', page: 10, box: [610, 260, 800, 730], file: 'images/fig-14.jpg' },
    { id: 'fig-15', page: 12, box: [100, 310, 210, 690], file: 'images/fig-15.jpg' },
    { id: 'fig-16', page: 12, box: [390, 345, 605, 650], file: 'images/fig-16.jpg' },
    { id: 'fig-17', page: 13, box: [125, 295, 305, 705], file: 'images/fig-17.jpg' },
    { id: 'fig-18', page: 14, box: [150, 80, 560, 910], file: 'images/fig-18.jpg' }
  ];

  // Perform crops
  for (const c of crops) {
    await crop(examDir, c.page, c.box, c.file);
  }

  manifest.figures = crops.map(c => ({
    id: c.id,
    file: c.file,
    page: c.page,
    box: c.box
  }));

  // Refine questions one by one
  const qs = manifest.questions;

  // Q2 is a table
  qs[1].options = ["A", "B", "C", "D"];
  qs[1].figures = ["fig-01"];
  qs[1].question = "Using the binomial naming system, the Arctic fox is called Vulpes lagopus .\nWhich row is correct?";

  // Q5 has a diagram
  qs[4].figures = ["fig-02"];

  // Q7 is a table
  qs[6].options = ["A", "B", "C", "D"];
  qs[6].figures = ["fig-03"];
  qs[6].question = "Which row describes osmosis?";

  // Q10 has a diagram
  qs[9].options = ["A", "B", "C", "D"];
  qs[9].figures = ["fig-04"];
  qs[9].question = "The diagram shows an experiment on the digestion of the protein in egg albumen by protease.\nThe protease was taken from a human stomach.\nIn which test-tube will the protein be digested most quickly?";

  // Q12 has a diagram + table
  qs[11].options = ["A", "B", "C", "D"];
  qs[11].figures = ["fig-05"];
  qs[11].question = "A student drew a diagram to show the substances used and produced in photosynthesis in a leaf.\n1 + 2 are used by the leaf\n3 + 4 are produced by the leaf\nWhich row shows the correct labels for the diagram?";

  // Q13 has a diagram
  qs[12].figures = ["fig-06"];
  qs[12].question = "The diagram shows a type of plant cell.\nIn which tissue is this cell found?";

  // Q15 has a table in question text
  qs[14].figures = ["fig-07"];
  qs[14].question = "The table shows the percentage of students from two schools who have one or more decayed teeth.\nWhat might explain these results?";

  // Q19 is a table
  qs[18].options = ["A", "B", "C", "D"];
  qs[18].figures = ["fig-08"];
  qs[18].question = "Which person is most at risk from developing coronary heart disease?";

  // Q20 is diagram + table
  qs[19].options = ["A", "B", "C", "D"];
  qs[19].figures = ["fig-09"];
  qs[19].question = "The diagram shows a section through a blood vessel.\nWhich type of blood vessel is shown, and in which direction does the blood flow?";

  // Q22 is diagram + table
  qs[21].options = ["A", "B", "C", "D"];
  qs[21].figures = ["fig-10"];
  qs[21].question = "The diagram shows an alveolus. The arrows represent the movement of gases.\nWhich row is correct?";

  // Q23 is diagram
  qs[22].options = ["A", "B", "C", "D"];
  qs[22].figures = ["fig-11"];
  qs[22].question = "Four flasks are sterilised and are set up as shown.\nWhich flask will contain the most alcohol after several hours?";

  // Q24 is diagram
  qs[23].options = ["A", "B", "C", "D"];
  qs[23].figures = ["fig-12"];
  qs[23].question = "In the diagram, which letter identifies the urethra?";

  // Q26 is table
  qs[25].options = ["A", "B", "C", "D"];
  qs[25].figures = ["fig-13"];
  qs[25].question = "The table shows some of the responses that occur in humans when body temperature changes.\nWhich row shows the responses that occur when the body temperature increases above normal?";

  // Q31 is diagram
  qs[30].options = ["A", "B", "C", "D"];
  qs[30].figures = ["fig-14"];
  qs[30].question = "The diagram shows the female reproductive system.\nWhere are gametes produced?";

  // Q36 is diagram
  qs[35].figures = ["fig-15"];
  qs[35].question = "The diagram shows a pyramid of numbers.\nWhich type of organism is found at level 1?";

  // Q37 is diagram
  qs[36].figures = ["fig-16"];
  qs[36].question = "The diagram shows part of the carbon cycle.\nWhich process occurs at Y?";

  // Q38 is diagram
  qs[37].figures = ["fig-17"];
  qs[37].question = "Chopped apple is placed into filter paper and a funnel as shown in the diagram.\nEnzymes are added to increase the volume of apple juice released.\nWhich enzyme would release the highest volume of juice?";

  // Q40 is diagram + graph
  qs[39].options = ["A", "B", "C", "D"];
  qs[39].figures = ["fig-18"];
  qs[39].question = "The diagram shows the positions of four farms and the concentrations of nitrate at different points in a river.\nWhich farm is likely to have been using too much fertiliser on its land?";

  await writeFile(examJsonPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Refined questions and figures for Paper 1`);
}

async function refinePaper2() {
  const examSlug = '0610-m20-qp-22';
  const examDir = path.resolve(`agent-conversion/output/2020 Feb-March/${examSlug}`);
  const examJsonPath = path.join(examDir, 'exam.json');
  const manifest = JSON.parse(await readFile(examJsonPath, 'utf8'));

  manifest.producedBy = 'gemini-3.5-flash';

  const crops = [
    { id: 'fig-01', page: 2, box: [282, 115, 410, 400], file: 'images/fig-01.jpg' },
    { id: 'fig-02', page: 3, box: [110, 330, 290, 670], file: 'images/fig-02.jpg' },
    { id: 'fig-03', page: 3, box: [535, 115, 700, 680], file: 'images/fig-03.jpg' },
    { id: 'fig-04', page: 4, box: [350, 130, 610, 830], file: 'images/fig-04.jpg' },
    { id: 'fig-05', page: 5, box: [100, 115, 205, 840], file: 'images/fig-05.jpg' }, // Diagram only for Q11
    { id: 'fig-06', page: 5, box: [250, 115, 385, 475], file: 'images/fig-06.jpg' }, // Table only for Q11
    { id: 'fig-07', page: 5, box: [430, 115, 715, 810], file: 'images/fig-07.jpg' }, // Q12 diagram + table
    { id: 'fig-08', page: 6, box: [100, 240, 200, 760], file: 'images/fig-08.jpg' }, // Q13 cell diagram
    { id: 'fig-09', page: 8, box: [100, 115, 435, 580], file: 'images/fig-09.jpg' }, // Q20 diagram + table
    { id: 'fig-10', page: 9, box: [100, 220, 220, 775], file: 'images/fig-10.jpg' }, // Q23 table
    { id: 'fig-11', page: 9, box: [420, 380, 570, 615], file: 'images/fig-11.jpg' }, // Q25 kidney diagram
    { id: 'fig-12', page: 10, box: [120, 250, 310, 730], file: 'images/fig-12.jpg' }, // Q26 synapse diagram
    { id: 'fig-13', page: 10, box: [385, 115, 530, 440], file: 'images/fig-13.jpg' }, // Q27 table
    { id: 'fig-14', page: 10, box: [585, 350, 730, 645], file: 'images/fig-14.jpg' }, // Q28 phototropism
    { id: 'fig-15', page: 11, box: [330, 245, 460, 750], file: 'images/fig-15.jpg' }, // Q30 sperm cell diagram
    { id: 'fig-16', page: 12, box: [100, 115, 246, 510], file: 'images/fig-16.jpg' }, // Q33 table
    { id: 'fig-17', page: 12, box: [450, 230, 685, 765], file: 'images/fig-17.jpg' }, // Q35 sickle-cell diagram
    { id: 'fig-18', page: 13, box: [390, 115, 595, 690], file: 'images/fig-18.jpg' }, // Q37 table
    { id: 'fig-19', page: 13, box: [710, 115, 840, 500], file: 'images/fig-19.jpg' }, // Q38 table
    { id: 'fig-20', page: 14, box: [150, 80, 560, 910], file: 'images/fig-20.jpg' }  // Q40 diagram + graph
  ];

  for (const c of crops) {
    await crop(examDir, c.page, c.box, c.file);
  }

  manifest.figures = crops.map(c => ({
    id: c.id,
    file: c.file,
    page: c.page,
    box: c.box
  }));

  const qs = manifest.questions;

  // Q2 is a table
  qs[1].options = ["A", "B", "C", "D"];
  qs[1].figures = ["fig-01"];
  qs[1].question = "Using the binomial naming system, the Arctic fox is called Vulpes lagopus .\nWhich row is correct?";

  // Q5 diagram
  qs[4].figures = ["fig-02"];

  // Q7 table
  qs[6].options = ["A", "B", "C", "D"];
  qs[6].figures = ["fig-03"];
  qs[6].question = "Which row describes osmosis?";

  // Q10 diagram
  qs[9].options = ["A", "B", "C", "D"];
  qs[9].figures = ["fig-04"];
  qs[9].question = "The diagram shows an experiment on the digestion of the protein in egg albumen by protease.\nThe protease was taken from a human stomach.\nIn which test-tube will the protein be digested most quickly?";

  // Q11 diagram + table
  qs[10].options = ["A", "B", "C", "D"];
  qs[10].figures = ["fig-05", "fig-06"];
  qs[10].question = "The diagram represents enzyme action.\nWhat are parts W, X and Y in this chemical reaction?";

  // Q12 diagram + table
  qs[11].options = ["A", "B", "C", "D"];
  qs[11].figures = ["fig-07"];
  qs[11].question = "A student drew a diagram to show the substances used and produced in photosynthesis in a leaf.\n1 + 2 are used by the leaf\n3 + 4 are produced by the leaf\nWhich row shows the correct labels for the diagram?";

  // Q13 diagram
  qs[12].figures = ["fig-08"];
  qs[12].question = "The diagram shows a type of plant cell.\nIn which tissue is this cell found?";

  // Q20 diagram + table
  qs[19].options = ["A", "B", "C", "D"];
  qs[19].figures = ["fig-09"];
  qs[19].question = "The diagram shows a section through a blood vessel.\nWhich type of blood vessel is shown, and in which direction does the blood flow?";

  // Q23 table
  qs[22].options = ["A", "B", "C", "D"];
  qs[22].figures = ["fig-10"];
  qs[22].question = "The table shows some of the changes that occur during breathing.\nWhich changes occur to cause inspiration?";

  // Q25 diagram
  qs[24].figures = ["fig-11"];
  qs[24].question = "The diagram shows a kidney and its blood vessels.\nIn a healthy person, which structure(s) transport glucose?";

  // Q26 diagram
  qs[25].options = ["A", "B", "C", "D"];
  qs[25].figures = ["fig-12"];
  qs[25].question = "The diagram shows a synapse.\nWhere are vesicles containing neurotransmitter molecules found?";

  // Q27 table
  qs[26].options = ["A", "B", "C", "D"];
  qs[26].figures = ["fig-13"];
  qs[26].question = "Which row shows the state of the ciliary muscles and suspensory ligaments, when the eye is focusing on a near object?";

  // Q28 diagram
  qs[27].figures = ["fig-14"];
  qs[27].question = "The diagram shows a shoot growing towards light.\nWhich statement about the role of auxin in phototropism is correct?";

  // Q30 diagram
  qs[29].options = ["A", "B", "C", "D"];
  qs[29].figures = ["fig-15"];
  qs[29].question = "The diagram shows a sperm cell.\nWhich part contains mitochondria to release energy for movement?";

  // Q33 table
  qs[32].options = ["A", "B", "C", "D"];
  qs[32].figures = ["fig-16"];
  qs[32].question = "Which row shows the features of stem cells?";

  // Q35 diagram
  qs[34].figures = ["fig-17"];
  qs[34].question = "The photomicrograph shows some red blood cells.\nWhat are the possible genotype combinations of this person?";

  // Q37 table
  qs[36].options = ["A", "B", "C", "D"];
  qs[36].figures = ["fig-18"];
  qs[36].question = "Which row describes how energy flows through a biological system?";

  // Q38 table
  qs[37].options = ["A", "B", "C", "D"];
  qs[37].figures = ["fig-19"];
  qs[37].question = "The diagram shows a food chain.\ngrass → mouse → owl\nWhich terms describe the position of the owl in this food chain?";

  // Q40 diagram + graph
  qs[39].options = ["A", "B", "C", "D"];
  qs[39].figures = ["fig-20"];
  qs[39].question = "The diagram shows the positions of four farms and the concentrations of nitrate at different points in a river.\nWhich farm is likely to have been using too much fertiliser on its land?";

  await writeFile(examJsonPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Refined questions and figures for Paper 2`);
}

async function run() {
  await refinePaper1();
  await refinePaper2();
}

run().catch(console.error);
