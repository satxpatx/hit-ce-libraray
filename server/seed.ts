import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { db, withTransaction } from './db.ts';
import { buildQrPayload, formatAccessionNumber, ROLE_PERMISSIONS, type UserRole } from '../src/lib/libraryRules.ts';

export const CIVIL_CATEGORIES: Array<{ name: string; code: string; description: string; isStandard?: boolean }> = [
  { name: 'Structural Engineering', code: 'STR', description: 'Analysis and design of load-bearing civil structures' },
  { name: 'Geotechnical Engineering', code: 'GEO', description: 'Soil mechanics, earth retaining structures, and slope stability' },
  { name: 'Transportation Engineering', code: 'TRN', description: 'Highway engineering, pavement design, and traffic systems' },
  { name: 'Environmental Engineering', code: 'ENV', description: 'Water supply, wastewater treatment, and air quality control' },
  { name: 'Water Resources Engineering', code: 'WRE', description: 'Hydrology, irrigation, watershed and river basin engineering' },
  { name: 'Hydraulics', code: 'HYD', description: 'Open channel flow, hydraulic machines, and fluid mechanics' },
  { name: 'Concrete Technology', code: 'CON', description: 'Properties of fresh and hardened concrete, mix proportioning' },
  { name: 'Construction Materials', code: 'MAT', description: 'Aggregates, cement, masonry, timber, polymers, and composites' },
  { name: 'Construction Management', code: 'CMG', description: 'Project scheduling, CPM/PERT, estimation, and contract administration' },
  { name: 'Building Materials and Construction', code: 'BMC', description: 'Building components, masonry, formwork, and finishing works' },
  { name: 'Surveying and Geomatics', code: 'SUR', description: 'Total station, GNSS, photogrammetry, remote sensing, and GIS' },
  { name: 'Engineering Geology', code: 'EGL', description: 'Petrology, structural geology, and geological site investigations' },
  { name: 'Foundation Engineering', code: 'FND', description: 'Shallow foundations, pile foundations, caissons, and ground improvement' },
  { name: 'Bridge Engineering', code: 'BRG', description: 'RCC, PSC, steel, cable-stayed, and suspension bridge engineering' },
  { name: 'Earthquake Engineering', code: 'EQK', description: 'Structural dynamics, seismic analysis, and ductile detailing' },
  { name: 'Steel Structures', code: 'STL', description: 'Limit state design of steel members, trusses, and plate girders' },
  { name: 'Reinforced Cement Concrete', code: 'RCC', description: 'Limit state and working stress design of RC beams, slabs, and columns' },
  { name: 'Prestressed Concrete', code: 'PSC', description: 'Pre-tensioned and post-tensioned concrete structures and losses' },
  { name: 'Finite Element Analysis', code: 'FEA', description: 'Variational formulations, stiffness matrices, and numerical structural modeling' },
  { name: 'Advanced Structural Analysis', code: 'ASA', description: 'Matrix methods, plasticity, shells, and nonlinear frame analysis' },
  { name: 'Computational Mechanics', code: 'CMP', description: 'Numerical algorithms, boundary elements, and structural optimization' },
  { name: 'Sustainable Construction', code: 'SUS', description: 'Life-cycle assessment, circular construction, and net-zero design' },
  { name: 'Green Building Materials', code: 'GBM', description: 'Low-carbon binders, recycled aggregates, and energy-efficient envelopes' },
  { name: 'Geopolymer Concrete', code: 'GPC', description: 'Fly-ash and slag-based inorganic alumino-silicate concrete systems' },
  { name: 'Alkali Activated Materials', code: 'AAM', description: 'Alkali-activated slag, metakaolin, and durability characterization' },
  { name: 'Fibre Reinforced Concrete', code: 'FRC', description: 'Steel, basalt, glass, and polypropylene fibre composite concretes' },
  { name: 'Machine Learning in Civil Engineering', code: 'MLC', description: 'Data-driven structural health monitoring, mix prediction, and geotech AI' },
  { name: 'Research Methodology', code: 'RMT', description: 'Experimental design, statistical analysis, and scholarly technical writing' },
  { name: 'Codes and Standards', code: 'STD', description: 'IS Codes, BIS, IRC, ASTM, ACI, and NBC design standards', isStandard: true },
  { name: 'General Engineering', code: 'GEN', description: 'Engineering mechanics, mathematics, graphics, and interdisciplinary texts' },
  { name: 'IS Codes & BIS Publications', code: 'BIS', description: 'Bureau of Indian Standards structural and materials specifications', isStandard: true },
  { name: 'IRC Publications', code: 'IRC', description: 'Indian Roads Congress highway, bridge, and traffic standards', isStandard: true },
  { name: 'ASTM & ACI Standards', code: 'ACI', description: 'American Society for Testing & Materials and ACI committee guides', isStandard: true },
  { name: 'National Building Code (NBC)', code: 'NBC', description: 'NBC India building regulations, fire safety, and structural provisions', isStandard: true },
  { name: 'GATE & Competitive Exams', code: 'GAT', description: 'GATE Civil Engineering, ESE, SSC JE, and PSU preparation resources' },
];

const DEMO_BOOK_CATALOGUE: Array<{
  title: string;
  subtitle?: string;
  author: string;
  publisher: string;
  category: string;
  subject: string;
  edition: string;
  year: number;
  price: number;
  keywords: string;
}> = [
  { title: 'Structural Analysis: Classical and Matrix Approaches', author: 'Dr. R. Subramanian', publisher: 'McGraw Hill Academic', category: 'Structural Engineering', subject: 'Indeterminate Structures', edition: '5th Edition', year: 2023, price: 780, keywords: 'trusses, frames, slope deflection, moment distribution' },
  { title: 'Elementary Structural Mechanics for Civil Engineers', author: 'Prof. S. K. Bhattacharya', publisher: 'New Age International', category: 'Structural Engineering', subject: 'Structural Mechanics', edition: '4th Edition', year: 2022, price: 640, keywords: 'bending moment, shear force, influence lines' },
  { title: 'Theory of Indeterminate Structures and Arches', author: 'Dr. A. K. Sengupta', publisher: 'PHI Learning', category: 'Structural Engineering', subject: 'Arches and Cables', edition: '3rd Edition', year: 2024, price: 720, keywords: 'arches, cables, strain energy, Castigliano' },
  { title: 'Principles of Geotechnical Engineering Practice', author: 'Dr. B. M. Chatterjee', publisher: 'Cengage India', category: 'Geotechnical Engineering', subject: 'Soil Mechanics', edition: '6th Edition', year: 2023, price: 890, keywords: 'shear strength, consolidation, seepage, compaction' },
  { title: 'Soil Mechanics and Slope Stability Engineering', author: 'Prof. V. N. Murthy', publisher: 'CBS Publishers', category: 'Geotechnical Engineering', subject: 'Slope Stability', edition: '4th Edition', year: 2021, price: 740, keywords: 'earth pressure, Rankine, Coulomb, Bishop method' },
  { title: 'Experimental Geotechnics and Subsurface Exploration', author: 'Dr. P. K. Basudhar', publisher: 'Springer Civil Series', category: 'Geotechnical Engineering', subject: 'Site Investigation', edition: '2nd Edition', year: 2024, price: 1120, keywords: 'SPT, CPT, triaxial test, borehole logging' },
  { title: 'Highway Engineering and Geometric Design', author: 'Prof. S. K. Khanna', publisher: 'Nem Chand & Bros', category: 'Transportation Engineering', subject: 'Highway Design', edition: '10th Edition', year: 2023, price: 690, keywords: 'sight distance, superelevation, flexible pavement' },
  { title: 'Traffic Engineering and Urban Transport Systems', author: 'Dr. L. R. Kadiyali', publisher: 'Khanna Publishers', category: 'Transportation Engineering', subject: 'Traffic Flow', edition: '8th Edition', year: 2022, price: 760, keywords: 'signal design, LOS, origin-destination, multimodal' },
  { title: 'Flexible and Rigid Pavement Analysis & Design', author: 'Dr. A. Veeraragavan', publisher: 'Oxford University Press India', category: 'Transportation Engineering', subject: 'Pavement Design', edition: '3rd Edition', year: 2024, price: 940, keywords: 'IRC 37, IRC 58, bituminous mix, CBR' },
  { title: 'Water Supply Engineering and Distribution Networks', author: 'Prof. S. K. Garg', publisher: 'Khanna Publishers', category: 'Environmental Engineering', subject: 'Water Treatment', edition: '12th Edition', year: 2023, price: 650, keywords: 'coagulation, filtration, chlorination, pipe networks' },
  { title: 'Wastewater Treatment and Resource Recovery', author: 'Dr. M. N. Rao', publisher: 'McGraw Hill Academic', category: 'Environmental Engineering', subject: 'Sewage Treatment', edition: '5th Edition', year: 2024, price: 880, keywords: 'activated sludge, BOD, COD, UASB, MBR' },
  { title: 'Air Pollution Control and Solid Waste Management', author: 'Dr. C. S. Rao', publisher: 'New Age International', category: 'Environmental Engineering', subject: 'Pollution Control', edition: '4th Edition', year: 2022, price: 610, keywords: 'particulate matter, sanitary landfill, composting' },
  { title: 'Engineering Hydrology and Catchment Modeling', author: 'Dr. K. Subramanya', publisher: 'McGraw Hill Academic', category: 'Water Resources Engineering', subject: 'Hydrology', edition: '5th Edition', year: 2023, price: 790, keywords: 'hydrograph, infiltration, flood routing, runoff' },
  { title: 'Irrigation Engineering and Hydraulic Structures', author: 'Prof. R. K. Sharma', publisher: 'S. Chand Academic', category: 'Water Resources Engineering', subject: 'Irrigation Structures', edition: '7th Edition', year: 2022, price: 720, keywords: 'weirs, barrages, gravity dams, canals, spillways' },
  { title: 'Groundwater Hydrology and Aquifer Management', author: 'Dr. D. K. Todd', publisher: 'Wiley India', category: 'Water Resources Engineering', subject: 'Groundwater', edition: '3rd Edition', year: 2021, price: 1050, keywords: 'Darcy law, well hydraulics, pumping test' },
  { title: 'Open Channel Hydraulics and Sediment Transport', author: 'Dr. K. Subramanya', publisher: 'McGraw Hill Academic', category: 'Hydraulics', subject: 'Open Channel Flow', edition: '5th Edition', year: 2023, price: 760, keywords: 'hydraulic jump, gradually varied flow, Manning' },
  { title: 'Fluid Mechanics and Hydraulic Machinery', author: 'Prof. R. K. Bansal', publisher: 'Laxmi Publications', category: 'Hydraulics', subject: 'Fluid Mechanics', edition: '9th Edition', year: 2022, price: 675, keywords: 'Bernoulli, boundary layer, Pelton, Francis turbine' },
  { title: 'Computational Fluid Hydraulics for Civil Works', author: 'Dr. S. Dey', publisher: 'Springer Civil Series', category: 'Hydraulics', subject: 'River Hydraulics', edition: '2nd Edition', year: 2024, price: 1290, keywords: 'scour, turbulence, open channel modeling' },
  { title: 'Concrete Technology: Theory and Field Practice', author: 'Prof. M. S. Shetty', publisher: 'S. Chand Academic', category: 'Concrete Technology', subject: 'Concrete Mix Design', edition: '8th Edition', year: 2023, price: 710, keywords: 'IS 10262, hydration, workability, durability' },
  { title: 'Properties of Concrete and Admixture Chemistry', author: 'Dr. A. M. Neville', publisher: 'Pearson India', category: 'Concrete Technology', subject: 'Concrete Durability', edition: '5th Edition', year: 2022, price: 980, keywords: 'creep, shrinkage, alkali-silica reaction, superplasticizer' },
  { title: 'High Performance and Self-Compacting Concrete', author: 'Dr. M. Santhanam', publisher: 'Universities Press', category: 'Concrete Technology', subject: 'Special Concretes', edition: '2nd Edition', year: 2024, price: 890, keywords: 'SCC, rheology, supplementary cementitious materials' },
  { title: 'Engineering Construction Materials and Testing', author: 'Dr. S. K. Duggal', publisher: 'New Age International', category: 'Construction Materials', subject: 'Material Characterization', edition: '5th Edition', year: 2023, price: 590, keywords: 'cement, brick, timber, bitumen, steel testing' },
  { title: 'Modern Masonry, Aggregates, and Structural Timber', author: 'Prof. P. C. Varghese', publisher: 'PHI Learning', category: 'Construction Materials', subject: 'Masonry and Timber', edition: '3rd Edition', year: 2021, price: 620, keywords: 'AAC blocks, mortar, graded aggregates' },
  { title: 'Bituminous Binders and Composite Civil Materials', author: 'Dr. R. S. Nair', publisher: 'CRC Academic India', category: 'Construction Materials', subject: 'Pavement Materials', edition: '2nd Edition', year: 2024, price: 950, keywords: 'polymer modified bitumen, geosynthetics, FRP' },
  { title: 'Construction Project Planning, Scheduling and Control', author: 'Prof. K. K. Chitkara', publisher: 'McGraw Hill Academic', category: 'Construction Management', subject: 'Project Scheduling', edition: '4th Edition', year: 2023, price: 840, keywords: 'CPM, PERT, earned value, resource leveling' },
  { title: 'Quantity Surveying, Estimation and Valuation', author: 'Prof. B. N. Dutta', publisher: 'UBS Academic', category: 'Construction Management', subject: 'Cost Estimation', edition: '11th Edition', year: 2022, price: 580, keywords: 'BOQ, rate analysis, tendering, valuation' },
  { title: 'Building Information Modeling and Lean Construction', author: 'Dr. A. Mahalingam', publisher: 'Oxford University Press India', category: 'Construction Management', subject: 'Digital Construction', edition: '1st Edition', year: 2025, price: 1080, keywords: 'BIM, 4D scheduling, Last Planner, safety management' },
  { title: 'Building Construction: Principles and Detailing', author: 'Prof. B. C. Punmia', publisher: 'Laxmi Publications', category: 'Building Materials and Construction', subject: 'Building Technology', edition: '11th Edition', year: 2023, price: 660, keywords: 'foundations, arches, lintels, staircases, roofing' },
  { title: 'Formwork, Scaffolding and Tall Building Systems', author: 'Dr. K. N. Jha', publisher: 'Pearson India', category: 'Building Materials and Construction', subject: 'Formwork Engineering', edition: '3rd Edition', year: 2024, price: 820, keywords: 'slipform, aluminium formwork, shoring, safety' },
  { title: 'Building Acoustics, Ventilation and Damp Proofing', author: 'Prof. S. C. Rangwala', publisher: 'Charotar Publishing', category: 'Building Materials and Construction', subject: 'Building Services', edition: '6th Edition', year: 2022, price: 540, keywords: 'waterproofing, thermal insulation, acoustics' },
  { title: 'Surveying Volume I & II: Plane and Geodetic', author: 'Prof. B. C. Punmia', publisher: 'Laxmi Publications', category: 'Surveying and Geomatics', subject: 'Classical Surveying', edition: '17th Edition', year: 2023, price: 790, keywords: 'levelling, theodolite, tachometry, curve setting' },
  { title: 'Modern Geomatics: Total Station, GNSS and LiDAR', author: 'Dr. A. M. Chandra', publisher: 'New Age International', category: 'Surveying and Geomatics', subject: 'Digital Geomatics', edition: '4th Edition', year: 2024, price: 870, keywords: 'RTK GPS, UAV photogrammetry, GIS mapping' },
  { title: 'Remote Sensing and GIS Applications in Civil Engineering', author: 'Dr. B. Bhatta', publisher: 'Oxford University Press India', category: 'Surveying and Geomatics', subject: 'GIS Engineering', edition: '3rd Edition', year: 2023, price: 910, keywords: 'DEM, watershed delineation, spatial analysis' },
  { title: 'Engineering and General Geology for Civil Engineers', author: 'Prof. Parbin Singh', publisher: 'S. K. Kataria & Sons', category: 'Engineering Geology', subject: 'Engineering Geology', edition: '8th Edition', year: 2022, price: 560, keywords: 'minerals, rocks, folds, faults, dam site geology' },
  { title: 'Rock Mechanics and Underground Tunnel Engineering', author: 'Dr. B. Singh', publisher: 'Elsevier Academic India', category: 'Engineering Geology', subject: 'Rock Mechanics', edition: '3rd Edition', year: 2024, price: 1180, keywords: 'RMR, Q-system, Hoek-Brown, NATM tunnelling' },
  { title: 'Foundation Analysis and Design', author: 'Dr. J. E. Bowles', publisher: 'McGraw Hill Academic', category: 'Foundation Engineering', subject: 'Shallow & Deep Foundations', edition: '5th Edition', year: 2022, price: 1240, keywords: 'bearing capacity, mat foundations, pile groups' },
  { title: 'Pile Foundations, Well Foundations and Ground Improvement', author: 'Prof. Swami Saran', publisher: 'PHI Learning', category: 'Foundation Engineering', subject: 'Deep Foundations', edition: '4th Edition', year: 2023, price: 860, keywords: 'stone columns, PVD, diaphragm walls, sheet piles' },
  { title: 'Geotechnical Design of Rafts and Machine Foundations', author: 'Dr. N. S. V. Kameswara Rao', publisher: 'Wiley India', category: 'Foundation Engineering', subject: 'Machine Foundations', edition: '2nd Edition', year: 2024, price: 1090, keywords: 'vibration isolation, soil-structure interaction' },
  { title: 'Design of Bridges: Concrete and Steel Superstructures', author: 'Dr. N. Krishna Raju', publisher: 'Oxford & IBH', category: 'Bridge Engineering', subject: 'Bridge Design', edition: '5th Edition', year: 2023, price: 920, keywords: 'IRC 6, T-beam, box girder, elastomeric bearings' },
  { title: 'Essentials of Bridge Engineering and Substructures', author: 'Prof. D. Johnson Victor', publisher: 'Oxford & IBH', category: 'Bridge Engineering', subject: 'Bridge Substructures', edition: '6th Edition', year: 2022, price: 780, keywords: 'piers, abutments, well sinking, scour depth' },
  { title: 'Cable-Stayed and Long-Span Bridge Engineering', author: 'Dr. P. P. Diwan', publisher: 'Springer Civil Series', category: 'Bridge Engineering', subject: 'Long-Span Bridges', edition: '2nd Edition', year: 2025, price: 1350, keywords: 'aerodynamics, stay cables, seismic isolation' },
  { title: 'Dynamics of Structures: Theory and Earthquake Applications', author: 'Dr. A. K. Chopra', publisher: 'Pearson India', category: 'Earthquake Engineering', subject: 'Structural Dynamics', edition: '5th Edition', year: 2023, price: 1190, keywords: 'SDOF, MDOF, response spectrum, modal analysis' },
  { title: 'Earthquake Resistant Design of Structures', author: 'Dr. Pankaj Agarwal', publisher: 'PHI Learning', category: 'Earthquake Engineering', subject: 'Seismic Design', edition: '3rd Edition', year: 2023, price: 840, keywords: 'IS 1893, IS 13920, ductile detailing, base isolation' },
  { title: 'Seismic Vulnerability and Retrofitting of RC Buildings', author: 'Dr. C. V. R. Murty', publisher: 'Universities Press', category: 'Earthquake Engineering', subject: 'Retrofitting', edition: '2nd Edition', year: 2024, price: 960, keywords: 'pushover analysis, FRP jacketing, shear walls' },
  { title: 'Design of Steel Structures by Limit State Method', author: 'Dr. N. Subramanian', publisher: 'Oxford University Press India', category: 'Steel Structures', subject: 'Limit State Steel', edition: '3rd Edition', year: 2023, price: 890, keywords: 'IS 800, bolted connections, plate girders, trusses' },
  { title: 'Limit State Design of Steel Structures', author: 'Prof. S. K. Duggal', publisher: 'McGraw Hill Academic', category: 'Steel Structures', subject: 'Steel Members', edition: '3rd Edition', year: 2022, price: 770, keywords: 'tension members, compression struts, gantry girders' },
  { title: 'Composite Steel-Concrete Structural Systems', author: 'Dr. R. P. Johnson', publisher: 'Wiley India', category: 'Steel Structures', subject: 'Composite Structures', edition: '3rd Edition', year: 2024, price: 1140, keywords: 'shear connectors, composite decks, braced frames' },
  { title: 'Reinforced Concrete Design (Limit State Approach)', author: 'Dr. S. U. Pillai', publisher: 'McGraw Hill Academic', category: 'Reinforced Cement Concrete', subject: 'RC Design', edition: '4th Edition', year: 2023, price: 860, keywords: 'IS 456, flexural design, shear, torsion, footings' },
  { title: 'Limit State Design of Reinforced Concrete', author: 'Prof. P. C. Varghese', publisher: 'PHI Learning', category: 'Reinforced Cement Concrete', subject: 'RC Elements', edition: '3rd Edition', year: 2022, price: 750, keywords: 'slabs, columns, interaction curves, staircases' },
  { title: 'Advanced Reinforced Concrete Design: Water Tanks & Silos', author: 'Dr. N. Krishna Raju', publisher: 'CBS Publishers', category: 'Reinforced Cement Concrete', subject: 'Special RC Structures', edition: '4th Edition', year: 2024, price: 810, keywords: 'IS 3370, overhead tanks, bunkers, silos, chimneys' },
  { title: 'Prestressed Concrete: Fundamentals and Design', author: 'Dr. N. Krishna Raju', publisher: 'McGraw Hill Academic', category: 'Prestressed Concrete', subject: 'Prestressing', edition: '6th Edition', year: 2023, price: 830, keywords: 'IS 1343, anchorage zone, losses, continuous beams' },
  { title: 'Design of Prestressed Concrete Structures', author: 'Prof. T. Y. Lin', publisher: 'Wiley India', category: 'Prestressed Concrete', subject: 'PSC Structures', edition: '3rd Edition', year: 2021, price: 1020, keywords: 'post-tensioning, tendon profile, deflection control' },
  { title: 'Post-Tensioned Concrete Slabs and Bridge Decks', author: 'Dr. S. Sengupta', publisher: 'PHI Learning', category: 'Prestressed Concrete', subject: 'Post-Tensioned Decks', edition: '2nd Edition', year: 2024, price: 940, keywords: 'flat slabs, balanced cantilever, creep losses' },
  { title: 'Concepts and Applications of Finite Element Analysis', author: 'Dr. R. D. Cook', publisher: 'Wiley India', category: 'Finite Element Analysis', subject: 'FEM Theory', edition: '4th Edition', year: 2022, price: 1150, keywords: 'isoparametric elements, Gauss quadrature, plates' },
  { title: 'Finite Element Method in Structural Engineering', author: 'Dr. C. S. Krishnamoorthy', publisher: 'McGraw Hill Academic', category: 'Finite Element Analysis', subject: 'Structural FEM', edition: '3rd Edition', year: 2023, price: 880, keywords: 'stiffness matrix, plane stress, shells, convergence' },
  { title: 'Nonlinear Finite Element Analysis for Civil Structures', author: 'Dr. K. J. Bathe', publisher: 'PHI Learning', category: 'Finite Element Analysis', subject: 'Nonlinear FEM', edition: '2nd Edition', year: 2024, price: 1320, keywords: 'plasticity, geometric nonlinearity, Newton-Raphson' },
  { title: 'Matrix Methods of Structural Analysis', author: 'Dr. Devdas Menon', publisher: 'Narosa Academic', category: 'Advanced Structural Analysis', subject: 'Matrix Analysis', edition: '2nd Edition', year: 2023, price: 790, keywords: 'direct stiffness method, flexibility matrix, 3D frames' },
  { title: 'Plastic Analysis and Design of Steel & RC Frames', author: 'Prof. B. G. Neal', publisher: 'Universities Press', category: 'Advanced Structural Analysis', subject: 'Plastic Analysis', edition: '3rd Edition', year: 2022, price: 840, keywords: 'collapse load, virtual work, yield line theory' },
  { title: 'Theory of Plates and Shells in Civil Engineering', author: 'Dr. S. Timoshenko', publisher: 'McGraw Hill Academic', category: 'Advanced Structural Analysis', subject: 'Plates & Shells', edition: '3rd Edition', year: 2021, price: 980, keywords: 'Kirchhoff plate, cylindrical shells, hyperbolic paraboloid' },
  { title: 'Computational Structural Mechanics and Optimization', author: 'Dr. S. Rajasekaran', publisher: 'Springer Civil Series', category: 'Computational Mechanics', subject: 'Structural Optimization', edition: '2nd Edition', year: 2024, price: 1160, keywords: 'genetic algorithms, topology optimization, MATLAB' },
  { title: 'Numerical Methods for Civil Engineering Systems', author: 'Prof. S. C. Chapra', publisher: 'McGraw Hill Academic', category: 'Computational Mechanics', subject: 'Numerical Computing', edition: '7th Edition', year: 2023, price: 820, keywords: 'ODE solvers, eigenvalue problems, finite differences' },
  { title: 'Continuum Mechanics for Structural and Geotech Engineers', author: 'Dr. J. N. Reddy', publisher: 'Cambridge India', category: 'Computational Mechanics', subject: 'Continuum Mechanics', edition: '2nd Edition', year: 2023, price: 1210, keywords: 'stress tensors, constitutive laws, elasticity' },
  { title: 'Sustainable Infrastructure and Green Construction Practices', author: 'Dr. M. K. Mondal', publisher: 'Elsevier Academic India', category: 'Sustainable Construction', subject: 'Sustainable Infrastructure', edition: '2nd Edition', year: 2024, price: 990, keywords: 'embodied carbon, GRIHA, LEED, circular economy' },
  { title: 'Life Cycle Assessment of Civil Engineering Structures', author: 'Dr. S. K. Roy', publisher: 'Springer Civil Series', category: 'Sustainable Construction', subject: 'LCA & Carbon Accounting', edition: '1st Edition', year: 2025, price: 1120, keywords: 'ISO 14040, carbon footprint, sustainable retrofitting' },
  { title: 'Low-Carbon Cements and Green Building Materials', author: 'Dr. R. Gettu', publisher: 'Universities Press', category: 'Green Building Materials', subject: 'LC3 & Eco-Materials', edition: '2nd Edition', year: 2024, price: 940, keywords: 'LC3 cement, calcined clay, recycled concrete aggregate' },
  { title: 'Recycled Aggregates and Industrial By-Products in Concrete', author: 'Dr. B. Bhattacharjee', publisher: 'CRC Academic India', category: 'Green Building Materials', subject: 'Waste Utilization', edition: '2nd Edition', year: 2023, price: 890, keywords: 'GGBS, fly ash, silica fume, copper slag, C&D waste' },
  { title: 'Geopolymer Concrete: Chemistry, Mix Design and Durability', author: 'Dr. B. V. Rangan', publisher: 'Elsevier Academic India', category: 'Geopolymer Concrete', subject: 'Geopolymer Systems', edition: '2nd Edition', year: 2024, price: 1250, keywords: 'sodium silicate, ambient curing, fly ash geopolymer' },
  { title: 'Structural Behavior of Reinforced Geopolymer Concrete', author: 'Dr. P. Nath', publisher: 'Springer Civil Series', category: 'Geopolymer Concrete', subject: 'Structural Geopolymer', edition: '1st Edition', year: 2025, price: 1180, keywords: 'bond strength, flexural behavior, chloride resistance' },
  { title: 'Alkali Activated Materials: Microstructure and Performance', author: 'Dr. J. L. Provis', publisher: 'Springer Civil Series', category: 'Alkali Activated Materials', subject: 'Alkali Activation', edition: '2nd Edition', year: 2023, price: 1340, keywords: 'C-A-S-H gel, N-A-S-H gel, slag activation, XRD, SEM' },
  { title: 'Durability of Alkali Activated Slag and Metakaolin Binders', author: 'Dr. S. Bernal', publisher: 'CRC Academic India', category: 'Alkali Activated Materials', subject: 'AAM Durability', edition: '1st Edition', year: 2024, price: 1190, keywords: 'carbonation, sulfate attack, acid resistance' },
  { title: 'Fibre Reinforced Concrete: Mechanical and Fracture Mechanics', author: 'Dr. A. Bentur', publisher: 'CRC Academic India', category: 'Fibre Reinforced Concrete', subject: 'FRC Mechanics', edition: '3rd Edition', year: 2023, price: 1110, keywords: 'steel fibres, toughness, post-cracking, UHPFRC' },
  { title: 'Ultra-High Performance and Hybrid Fibre Concrete', author: 'Dr. V. C. Li', publisher: 'Elsevier Academic India', category: 'Fibre Reinforced Concrete', subject: 'ECC & UHPFRC', edition: '2nd Edition', year: 2024, price: 1280, keywords: 'ECC, strain hardening, basalt fibres, impact resistance' },
  { title: 'Machine Learning Applications in Civil and Structural Engineering', author: 'Dr. P. Samui', publisher: 'Elsevier Academic India', category: 'Machine Learning in Civil Engineering', subject: 'Civil AI & ML', edition: '2nd Edition', year: 2025, price: 1290, keywords: 'ANN, XGBoost, strength prediction, SHM' },
  { title: 'Deep Learning for Structural Health Monitoring and Inspection', author: 'Dr. A. Alavi', publisher: 'Springer Civil Series', category: 'Machine Learning in Civil Engineering', subject: 'Computer Vision SHM', edition: '1st Edition', year: 2025, price: 1350, keywords: 'crack detection, CNN, sensor fusion, digital twin' },
  { title: 'Data-Driven Geotechnics and Pavement Performance Modeling', author: 'Dr. S. K. Das', publisher: 'CRC Academic India', category: 'Machine Learning in Civil Engineering', subject: 'Geotech ML', edition: '1st Edition', year: 2024, price: 1140, keywords: 'liquefaction prediction, SVM, random forest' },
  { title: 'Research Methodology: Methods and Techniques for Engineers', author: 'Dr. C. R. Kothari', publisher: 'New Age International', category: 'Research Methodology', subject: 'Research Methods', edition: '5th Edition', year: 2023, price: 495, keywords: 'hypothesis testing, ANOVA, sampling, ethics' },
  { title: 'Design of Experiments and Statistical Analysis in Civil Labs', author: 'Dr. D. C. Montgomery', publisher: 'Wiley India', category: 'Research Methodology', subject: 'Experimental Design', edition: '9th Edition', year: 2022, price: 1090, keywords: 'Taguchi, response surface methodology, regression' },
  { title: 'Technical Writing, Patent Drafting and Scholarly Publishing', author: 'Prof. R. Ghosh', publisher: 'PHI Learning', category: 'Research Methodology', subject: 'Technical Communication', edition: '2nd Edition', year: 2024, price: 540, keywords: 'literature review, citation, peer review, LaTeX' },
  { title: 'Compendium of Structural Engineering Design Codes Overview', author: 'BIS Technical Editorial Panel', publisher: 'Departmental Reference Press', category: 'Codes and Standards', subject: 'Design Standards Guide', edition: '2024 Edition', year: 2024, price: 650, keywords: 'IS 456, IS 800, IS 875, load combinations' },
  { title: 'Commentary on Limit State Design Provisions for Concrete', author: 'Dr. S. K. Kaushik', publisher: 'CBS Publishers', category: 'IS Codes & BIS Publications', subject: 'IS 456 Commentary', edition: '3rd Edition', year: 2023, price: 720, keywords: 'SP 16, SP 34, detailing handbook, BIS' },
  { title: 'Handbook on Wind and Seismic Load Calculations (IS 875 / IS 1893)', author: 'Prof. A. K. Jain', publisher: 'Nem Chand & Bros', category: 'IS Codes & BIS Publications', subject: 'Loading Standards', edition: '4th Edition', year: 2024, price: 760, keywords: 'wind loads, seismic zones, drift limits' },
  { title: 'Guide to Concrete Mix Proportioning per IS 10262', author: 'Dr. M. C. Nataraja', publisher: 'PHI Learning', category: 'IS Codes & BIS Publications', subject: 'IS 10262 Guide', edition: '2nd Edition', year: 2024, price: 590, keywords: 'water-cement ratio, mineral admixtures, trial mixes' },
  { title: 'IRC Bridge Loading and Concrete Bridge Design Handbook', author: 'Prof. V. K. Raina', publisher: 'McGraw Hill Academic', category: 'IRC Publications', subject: 'IRC 6 & IRC 112', edition: '4th Edition', year: 2023, price: 980, keywords: 'Class AA, 70R loading, limit state bridge design' },
  { title: 'Highway Materials and Flexible Pavement IRC Guidelines Review', author: 'Dr. P. Kumar', publisher: 'Khanna Publishers', category: 'IRC Publications', subject: 'IRC 37 Review', edition: '3rd Edition', year: 2024, price: 740, keywords: 'subgrade CBR, bituminous macadam, fatigue' },
  { title: 'Guide to ASTM Concrete & Soil Laboratory Testing Standards', author: 'Dr. R. D. Hooton', publisher: 'CRC Academic India', category: 'ASTM & ACI Standards', subject: 'ASTM Testing Guide', edition: '2nd Edition', year: 2023, price: 1120, keywords: 'RCPT, ASTM C1202, triaxial ASTM, shrinkage' },
  { title: 'ACI 318 Structural Concrete Design Companion & Worked Examples', author: 'Dr. J. K. Wight', publisher: 'Pearson India', category: 'ASTM & ACI Standards', subject: 'ACI 318 Companion', edition: '8th Edition', year: 2023, price: 1260, keywords: 'LRFD, strut-and-tie, seismic frames, ACI' },
  { title: 'National Building Code of India: Structural & Fire Safety Guide', author: 'Prof. S. K. Roychowdhury', publisher: 'New Age International', category: 'National Building Code (NBC)', subject: 'Building Regulations', edition: '3rd Edition', year: 2024, price: 820, keywords: 'NBC Part 4, Part 6, egress, occupancy classification' },
  { title: 'NBC Plumbing, Lighting and Sustainable Building Services', author: 'Dr. A. Sengupta', publisher: 'CBS Publishers', category: 'National Building Code (NBC)', subject: 'NBC Services', edition: '2nd Edition', year: 2023, price: 690, keywords: 'rainwater harvesting, ventilation, drainage' },
  { title: 'GATE Civil Engineering: Comprehensive Concept & Formula Bank', author: 'HIT CE Academic Forum', publisher: 'Departmental Reference Press', category: 'GATE & Competitive Exams', subject: 'GATE Preparation', edition: '2026 Edition', year: 2026, price: 550, keywords: 'GATE CE, previous years, structural, geotech, env' },
  { title: 'ESE & PSU Civil Engineering Objective Practice Manual', author: 'Prof. R. Agor', publisher: 'Khanna Publishers', category: 'GATE & Competitive Exams', subject: 'ESE & PSU Exams', edition: '9th Edition', year: 2025, price: 680, keywords: 'IES, SSC JE, conventional questions, civil MCQ' },
  { title: 'Engineering Mechanics: Statics and Dynamics', author: 'Prof. S. S. Bhavikatti', publisher: 'New Age International', category: 'General Engineering', subject: 'Engineering Mechanics', edition: '7th Edition', year: 2023, price: 540, keywords: 'equilibrium, friction, centroid, kinematics' },
  { title: 'Strength of Materials for Civil Engineers', author: 'Dr. R. K. Bansal', publisher: 'Laxmi Publications', category: 'General Engineering', subject: 'Solid Mechanics', edition: '6th Edition', year: 2022, price: 640, keywords: 'Mohr circle, torsion, columns, deflection' },
  { title: 'Higher Engineering Mathematics for Civil Modeling', author: 'Dr. B. S. Grewal', publisher: 'Khanna Publishers', category: 'General Engineering', subject: 'Engineering Mathematics', edition: '44th Edition', year: 2023, price: 795, keywords: 'PDE, Laplace, matrices, vector calculus, probability' },
  { title: 'Engineering Drawing and AutoCAD Civil Drafting', author: 'Prof. N. D. Bhatt', publisher: 'Charotar Publishing', category: 'General Engineering', subject: 'CAD Drafting', edition: '54th Edition', year: 2023, price: 510, keywords: 'orthographic, building plans, AutoCAD, detailing' },
  { title: 'Coastal Engineering and Port Infrastructure Design', author: 'Dr. V. Sundar', publisher: 'Springer Civil Series', category: 'Water Resources Engineering', subject: 'Coastal Structures', edition: '2nd Edition', year: 2024, price: 1220, keywords: 'breakwaters, jetties, Haldia port, dredging, waves' },
  { title: 'Railway, Airport and Harbour Engineering', author: 'Prof. S. C. Saxena', publisher: 'Dhanpat Rai Academic', category: 'Transportation Engineering', subject: 'Multimodal Transport', edition: '8th Edition', year: 2022, price: 670, keywords: 'track geometry, runway length, port terminals' },
  { title: 'Environmental Impact Assessment for Infrastructure Projects', author: 'Dr. A. K. Shrivastava', publisher: 'PHI Learning', category: 'Environmental Engineering', subject: 'EIA & Sustainability', edition: '3rd Edition', year: 2024, price: 730, keywords: 'EIA notification, baseline monitoring, mitigation' },
  { title: 'Ground Anchors, Soil Nailing and Geosynthetics', author: 'Dr. G. V. Rao', publisher: 'Universities Press', category: 'Geotechnical Engineering', subject: 'Reinforced Earth', edition: '2nd Edition', year: 2024, price: 960, keywords: 'geotextiles, MSE walls, soil nails, retaining' },
  { title: 'Structural Repair, Rehabilitation and Nondestructive Testing', author: 'Dr. P. C. Varghese', publisher: 'PHI Learning', category: 'Concrete Technology', subject: 'NDT & Repair', edition: '2nd Edition', year: 2024, price: 840, keywords: 'UPV, rebound hammer, corrosion, micro-concrete' },
  { title: 'Tall Building Structural Systems and Wind Engineering', author: 'Dr. B. S. Taranath', publisher: 'CRC Academic India', category: 'Structural Engineering', subject: 'Tall Buildings', edition: '3rd Edition', year: 2023, price: 1380, keywords: 'outrigger, diagrid, tube structures, vortex shedding' },
];

const DEMO_STUDENTS = [
  { reg: 'HIT/CE/2023/001', name: 'Aritra Mukherjee', prog: 'B.Tech Civil Engineering', sem: 6, session: '2023-2027', email: 'aritra.mukherjee.demo@hithaldia.edu.in', phone: '+91-98301-10001' },
  { reg: 'HIT/CE/2023/002', name: 'Subhamoy Chatterjee', prog: 'B.Tech Civil Engineering', sem: 6, session: '2023-2027', email: 'subhamoy.chatterjee.demo@hithaldia.edu.in', phone: '+91-98301-10002' },
  { reg: 'HIT/CE/2023/003', name: 'Ananya Banerjee', prog: 'B.Tech Civil Engineering', sem: 6, session: '2023-2027', email: 'ananya.banerjee.demo@hithaldia.edu.in', phone: '+91-98301-10003' },
  { reg: 'HIT/CE/2023/004', name: 'Debanjan Maity', prog: 'B.Tech Civil Engineering', sem: 6, session: '2023-2027', email: 'debanjan.maity.demo@hithaldia.edu.in', phone: '+91-98301-10004' },
  { reg: 'HIT/CE/2023/005', name: 'Pritam Mondal', prog: 'B.Tech Civil Engineering', sem: 6, session: '2023-2027', email: 'pritam.mondal.demo@hithaldia.edu.in', phone: '+91-98301-10005' },
  { reg: 'HIT/CE/2024/006', name: 'Rittika Sen', prog: 'B.Tech Civil Engineering', sem: 4, session: '2024-2028', email: 'rittika.sen.demo@hithaldia.edu.in', phone: '+91-98301-10006' },
  { reg: 'HIT/CE/2024/007', name: 'Souvik Jana', prog: 'B.Tech Civil Engineering', sem: 4, session: '2024-2028', email: 'souvik.jana.demo@hithaldia.edu.in', phone: '+91-98301-10007' },
  { reg: 'HIT/CE/2024/008', name: 'Sohini Dasgupta', prog: 'B.Tech Civil Engineering', sem: 4, session: '2024-2028', email: 'sohini.dasgupta.demo@hithaldia.edu.in', phone: '+91-98301-10008' },
  { reg: 'HIT/CE/2024/009', name: 'Tathagata Ghosh', prog: 'B.Tech Civil Engineering', sem: 4, session: '2024-2028', email: 'tathagata.ghosh.demo@hithaldia.edu.in', phone: '+91-98301-10009' },
  { reg: 'HIT/CE/2024/010', name: 'Mousumi Patra', prog: 'B.Tech Civil Engineering', sem: 4, session: '2024-2028', email: 'mousumi.patra.demo@hithaldia.edu.in', phone: '+91-98301-10010' },
  { reg: 'HIT/CE/2022/011', name: 'Indranil Roy', prog: 'B.Tech Civil Engineering', sem: 8, session: '2022-2026', email: 'indranil.roy.demo@hithaldia.edu.in', phone: '+91-98301-10011' },
  { reg: 'HIT/CE/2022/012', name: 'Sayantani Paul', prog: 'B.Tech Civil Engineering', sem: 8, session: '2022-2026', email: 'sayantani.paul.demo@hithaldia.edu.in', phone: '+91-98301-10012' },
  { reg: 'HIT/CE/2022/013', name: 'Koushik Bera', prog: 'B.Tech Civil Engineering', sem: 8, session: '2022-2026', email: 'koushik.bera.demo@hithaldia.edu.in', phone: '+91-98301-10013' },
  { reg: 'HIT/CE/2022/014', name: 'Nabanita Saha', prog: 'B.Tech Civil Engineering', sem: 8, session: '2022-2026', email: 'nabanita.saha.demo@hithaldia.edu.in', phone: '+91-98301-10014' },
  { reg: 'HIT/CE/2022/015', name: 'Arpan Halder', prog: 'B.Tech Civil Engineering', sem: 8, session: '2022-2026', email: 'arpan.halder.demo@hithaldia.edu.in', phone: '+91-98301-10015' },
  { reg: 'HIT/CE/2025/016', name: 'Sayan Chakraborty', prog: 'B.Tech Civil Engineering', sem: 2, session: '2025-2029', email: 'sayan.chakraborty.demo@hithaldia.edu.in', phone: '+91-98301-10016' },
  { reg: 'HIT/CE/2025/017', name: 'Rupsa Bhattacharya', prog: 'B.Tech Civil Engineering', sem: 2, session: '2025-2029', email: 'rupsa.bhattacharya.demo@hithaldia.edu.in', phone: '+91-98301-10017' },
  { reg: 'HIT/CE/2025/018', name: 'Dipankar Samanta', prog: 'M.Tech Structural Engineering', sem: 2, session: '2025-2027', email: 'dipankar.samanta.demo@hithaldia.edu.in', phone: '+91-98301-10018' },
  { reg: 'HIT/CE/2025/019', name: 'Shreya Kar', prog: 'M.Tech Structural Engineering', sem: 2, session: '2025-2027', email: 'shreya.kar.demo@hithaldia.edu.in', phone: '+91-98301-10019' },
  { reg: 'HIT/CE/2025/020', name: 'Suman Kumar Dey', prog: 'M.Tech Geotechnical Engineering', sem: 4, session: '2024-2026', email: 'suman.dey.demo@hithaldia.edu.in', phone: '+91-98301-10020' },
];

const DEMO_FACULTY = [
  { empId: 'HIT-FAC-CE-001', name: 'Prof. (Dr.) Debashis Sarkar', designation: 'Professor & Head of Department', email: 'debashis.sarkar.demo@hithaldia.edu.in', phone: '+91-94340-20001' },
  { empId: 'HIT-FAC-CE-002', name: 'Dr. Soma Chatterjee', designation: 'Professor (Structural Engineering)', email: 'soma.chatterjee.demo@hithaldia.edu.in', phone: '+91-94340-20002' },
  { empId: 'HIT-FAC-CE-003', name: 'Dr. Pradip Kumar Mandal', designation: 'Associate Professor (Geotechnical)', email: 'pradip.mandal.demo@hithaldia.edu.in', phone: '+91-94340-20003' },
  { empId: 'HIT-FAC-CE-004', name: 'Dr. Anirban Ghosh', designation: 'Associate Professor (Concrete Tech)', email: 'anirban.ghosh.demo@hithaldia.edu.in', phone: '+91-94340-20004' },
  { empId: 'HIT-FAC-CE-005', name: 'Dr. Moumita Sen', designation: 'Assistant Professor (Environmental)', email: 'moumita.sen.demo@hithaldia.edu.in', phone: '+91-94340-20005' },
  { empId: 'HIT-FAC-CE-006', name: 'Prof. Subhajit Jana', designation: 'Assistant Professor (Transportation)', email: 'subhajit.jana.demo@hithaldia.edu.in', phone: '+91-94340-20006' },
  { empId: 'HIT-FAC-CE-007', name: 'Dr. Tapas Kumar Roy', designation: 'Assistant Professor (Water Resources)', email: 'tapas.roy.demo@hithaldia.edu.in', phone: '+91-94340-20007' },
  { empId: 'HIT-FAC-CE-008', name: 'Prof. Rima Bhattacharjee', designation: 'Assistant Professor (Surveying & GIS)', email: 'rima.bhattacharjee.demo@hithaldia.edu.in', phone: '+91-94340-20008' },
  { empId: 'HIT-FAC-CE-009', name: 'Dr. Sandip Kumar Maity', designation: 'Assistant Professor (Earthquake Engg)', email: 'sandip.maity.demo@hithaldia.edu.in', phone: '+91-94340-20009' },
  { empId: 'HIT-FAC-CE-010', name: 'Prof. Sujoy Das', designation: 'Assistant Professor (Construction Mgmt)', email: 'sujoy.das.demo@hithaldia.edu.in', phone: '+91-94340-20010' },
];

const DEMO_DIGITAL_RESOURCES = [
  { title: 'CE-501 Structural Analysis I – Complete Lecture Notes', author: 'Dr. Soma Chatterjee', category: 'Lecture notes', subject: 'Structural Engineering', semester: '5th Semester', year: '2025-2026', desc: 'Sample departmental lecture notes covering determinate/indeterminate beams, arches, and influence line diagrams.' },
  { title: 'CE-602 Design of RC Structures – Limit State Lecture Handouts', author: 'Dr. Anirban Ghosh', category: 'Lecture notes', subject: 'Reinforced Cement Concrete', semester: '6th Semester', year: '2025-2026', desc: 'Sample worked examples on singly/doubly reinforced beams, two-way slabs, and short columns.' },
  { title: 'Geotechnical Engineering Laboratory Manual (Soil Testing)', author: 'Dr. Pradip Kumar Mandal', category: 'Laboratory manuals', subject: 'Geotechnical Engineering', semester: '5th Semester', year: '2025-2026', desc: 'Procedures for sieve analysis, Atterberg limits, Proctor compaction, direct shear, and consolidation tests.' },
  { title: 'Concrete Technology & Material Testing Lab Manual', author: 'Dr. Anirban Ghosh', category: 'Laboratory manuals', subject: 'Concrete Technology', semester: '4th Semester', year: '2025-2026', desc: 'Standard test procedures for cement consistency, slump cone, cube compression, and flexural strength.' },
  { title: 'Environmental Engineering Lab Manual (Water & Wastewater)', author: 'Dr. Moumita Sen', category: 'Laboratory manuals', subject: 'Environmental Engineering', semester: '6th Semester', year: '2025-2026', desc: 'Analytical methods for pH, turbidity, hardness, DO, BOD5, COD, and jar coagulation testing.' },
  { title: 'Surveying & Total Station Field Practical Manual', author: 'Prof. Rima Bhattacharjee', category: 'Laboratory manuals', subject: 'Surveying and Geomatics', semester: '4th Semester', year: '2025-2026', desc: 'Field exercises on auto-level traversing, total station stakeout, and contour mapping.' },
  { title: 'B.Tech Civil Engineering End-Semester Question Bank (2021–2025)', author: 'Department Examination Cell', category: 'Previous year question papers', subject: 'General Engineering', semester: 'All Semesters', year: '2025-2026', desc: 'Compiled sample university examination papers across Structural, Geotechnical, and Hydraulics courses.' },
  { title: 'GATE Civil Engineering Previous Papers Solution Compendium', author: 'HIT CE GATE Forum', category: 'Previous year question papers', subject: 'GATE & Competitive Exams', semester: '7th-8th Semester', year: '2025-2026', desc: 'Annotated solution guide for GATE Civil Engineering quantitative and core subject problems.' },
  { title: 'Ambient-Cured Fly Ash & GGBS Geopolymer Concrete Durability Study', author: 'Dr. Anirban Ghosh & M.Tech Scholars', category: 'Research papers', subject: 'Geopolymer Concrete', semester: 'Postgraduate', year: '2025-2026', desc: 'Sample open-access departmental research paper investigating marine chloride ingress in Haldia coastal exposure.' },
  { title: 'Machine Learning Prediction of Basalt Fibre Concrete Compressive Strength', author: 'Dr. Sandip Kumar Maity', category: 'Research papers', subject: 'Machine Learning in Civil Engineering', semester: 'Postgraduate', year: '2025-2026', desc: 'Sample comparative benchmark of Random Forest, XGBoost, and ANN models on experimental mix datasets.' },
  { title: 'Seismic Performance Evaluation of G+10 RC Frame with Shear Walls', author: 'Indranil Roy & Team (Sample B.Tech Project)', category: 'Project reports', subject: 'Earthquake Engineering', semester: '8th Semester', year: '2025-2026', desc: 'Sample final-year capstone project report covering response spectrum and pushover modeling.' },
  { title: 'Sustainable Pervious Concrete Pavement Design for Campus Roads', author: 'Sayantani Paul & Team (Sample B.Tech Project)', category: 'Project reports', subject: 'Sustainable Construction', semester: '8th Semester', year: '2025-2026', desc: 'Sample project evaluating infiltration rates and compressive performance of pervious concrete mixes.' },
  { title: 'Open-Access Guide to Open Channel Hydraulics Fundamentals', author: 'Open Civil Engineering Consortium', category: 'Open-access books', subject: 'Hydraulics', semester: '4th Semester', year: '2024-2025', desc: 'CC-BY open-access textbook covering uniform flow, specific energy, and hydraulic jumps.' },
  { title: 'Public Guidelines for Rainwater Harvesting & Urban Drainage (CPHEEO Summary)', author: 'Departmental Study Circle', category: 'Publicly available codes and guidelines', subject: 'Water Resources Engineering', semester: '6th Semester', year: '2025-2026', desc: 'Public-domain reference summary of rooftop rainwater harvesting and campus stormwater recharge.' },
  { title: 'International Conference Proceedings: Advances in Sustainable Geotechnics', author: 'HIT CE Symposium Committee', category: 'Conference publications', subject: 'Geotechnical Engineering', semester: 'Postgraduate', year: '2025-2026', desc: 'Sample abstract book and technical papers from the Departmental Civil Engineering Symposium.' },
];

const DEMO_ACQUISITION_REQUESTS = [
  { title: 'Design of Tall Concrete Buildings for Wind and Earthquake', author: 'Dr. M. Bungale', isbn: '978-0071845123', publisher: 'McGraw Hill Academic', subject: 'Earthquake Engineering', reason: 'Essential reference for M.Tech Structural Dynamics seminar course.', priority: 'HIGH', status: 'PENDING' },
  { title: 'Alkali-Activated Cements and Concretes in Coastal Zones', author: 'Dr. C. Shi', isbn: '978-0415700047', publisher: 'CRC Academic India', subject: 'Alkali Activated Materials', reason: 'Directly supports ongoing departmental research on Haldia marine durability.', priority: 'HIGH', status: 'APPROVED' },
  { title: 'Python for Civil Engineers: Structural & Hydrological Computing', author: 'Dr. V. K. Singh', isbn: '978-3030912345', publisher: 'Springer Civil Series', subject: 'Machine Learning in Civil Engineering', reason: 'Requested for 6th semester computational laboratory elective.', priority: 'MEDIUM', status: 'PENDING' },
  { title: 'Unsaturated Soil Mechanics in Geotechnical Practice', author: 'Dr. D. G. Fredlund', isbn: '978-1118133590', publisher: 'Wiley India', subject: 'Geotechnical Engineering', reason: 'Needed for postgraduate thesis work on monsoon slope failures.', priority: 'MEDIUM', status: 'APPROVED' },
  { title: 'Bridge Aesthetics and Seismic Isolation Bearings', author: 'Dr. M. Priestley', isbn: '978-0471598473', publisher: 'Wiley India', subject: 'Bridge Engineering', reason: 'Useful for 7th semester Bridge Engineering elective.', priority: 'LOW', status: 'PURCHASED' },
  { title: 'Drone Photogrammetry and LiDAR Surveying Workflows', author: 'Dr. K. P. Rao', isbn: '978-9354601122', publisher: 'Oxford University Press India', subject: 'Surveying and Geomatics', reason: 'Modernizes surveying practical syllabus with UAV mapping examples.', priority: 'HIGH', status: 'PENDING' },
  { title: 'Advanced Wastewater Membrane Bioreactor Systems', author: 'Dr. S. Judd', isbn: '978-0080966823', publisher: 'Elsevier Academic India', subject: 'Environmental Engineering', reason: 'Requested by Environmental Engineering lab faculty.', priority: 'MEDIUM', status: 'PURCHASED' },
  { title: 'Basalt and Carbon Fibre Reinforced Polymer Retrofitting Manual', author: 'Dr. R. Sen', isbn: '978-9811678901', publisher: 'Springer Civil Series', subject: 'Fibre Reinforced Concrete', reason: 'Reference for structural rehabilitation laboratory experiments.', priority: 'HIGH', status: 'APPROVED' },
  { title: 'Construction Contracts, Arbitration and FIDIC Conditions', author: 'Prof. P. K. Joy', isbn: '978-8120359012', publisher: 'PHI Learning', subject: 'Construction Management', reason: 'Requested for final-year Construction Management & Contracts course.', priority: 'LOW', status: 'REJECTED' },
  { title: 'Geopolymer Mortar and Concrete: Field Case Studies in India', author: 'Dr. N. P. Rajamane', isbn: '978-8194812098', publisher: 'Universities Press', subject: 'Geopolymer Concrete', reason: 'High student demand for sustainable concrete project work.', priority: 'HIGH', status: 'PENDING' },
];

export function seedDatabaseIfEmpty(): void {
  const existingRoles = db.prepare('SELECT COUNT(*) as c FROM roles').get() as { c: number };
  if (existingRoles.c > 0) {
    return;
  }

  console.log('Initializing HIT Civil Engineering – Digital Library database with demonstration dataset...');

  withTransaction(() => {
    // 1. Institution Settings
    db.prepare(`
      INSERT INTO institution_settings (
        id, institution_name, department_name, location, application_name, tagline, academic_session,
        accession_prefix, accession_year_format, accession_start_sequence,
        student_borrow_limit, faculty_borrow_limit, student_loan_days, faculty_loan_days,
        max_renewals, fine_per_day_inr, max_fine_inr, reservation_expiry_hours, email_notifications_on
      ) VALUES (
        1, 'Haldia Institute of Technology', 'Department of Civil Engineering',
        'Haldia, West Bengal, India', 'HIT Civil Engineering – Digital Library',
        'Knowledge. Research. Innovation.', '2026-2027',
        'HIT-CE', 'CALENDAR', 1,
        4, 8, 14, 30,
        2, 5.0, 500.0, 48, 0
      )
    `).run();

    // 2. Department
    const deptInfo = db
      .prepare(
        `INSERT INTO departments (code, name, hod_name, location) VALUES (?, ?, ?, ?)`
      )
      .run('CE', 'Department of Civil Engineering', 'Prof. (Dr.) Debashis Sarkar (Sample)', 'HIT Campus, ICARE Complex, Haldia, West Bengal');
    const ceDeptId = Number(deptInfo.lastInsertRowid);

    // 3. Roles & Permissions
    const roleDescriptions: Record<UserRole, string> = {
      SUPER_ADMIN: 'Complete institutional library system administration and policy governance',
      LIBRARIAN: 'Day-to-day cataloguing, accession register, circulation, fines, and digital repository management',
      FACULTY: 'Department faculty member with extended borrowing privileges, renewals, and acquisition requests',
      STUDENT: 'Civil Engineering student with catalogue search, reservations, borrowing history, and digital access',
    };

    const roleIds: Record<string, number> = {};
    const insertRole = db.prepare('INSERT INTO roles (name, description) VALUES (?, ?)');
    const insertPerm = db.prepare('INSERT OR IGNORE INTO permissions (code, module, description) VALUES (?, ?, ?)');
    const getPerm = db.prepare('SELECT id FROM permissions WHERE code = ?');
    const insertRolePerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');

    for (const roleName of Object.keys(ROLE_PERMISSIONS) as UserRole[]) {
      const r = insertRole.run(roleName, roleDescriptions[roleName]);
      roleIds[roleName] = Number(r.lastInsertRowid);
      for (const permCode of ROLE_PERMISSIONS[roleName]) {
        const mod = permCode.split('.')[0];
        insertPerm.run(permCode, mod, `Access permission for ${permCode}`);
        const p = getPerm.get(permCode) as { id: number };
        insertRolePerm.run(roleIds[roleName], p.id);
      }
    }

    // 4. Primary Demo Role Accounts (bcrypt hashed; clearly labelled demonstration accounts)
    const adminHash = bcrypt.hashSync(process.env.INITIAL_ADMIN_PASSWORD || 'Admin@HIT2026', 10);
    const librarianHash = bcrypt.hashSync('Librarian@HIT2026', 10);
    const facultyHash = bcrypt.hashSync('Faculty@HIT2026', 10);
    const studentHash = bcrypt.hashSync('Student@HIT2026', 10);

    const insertUser = db.prepare(`
      INSERT INTO users (email, password_hash, full_name, phone, role_id, department_id, status, is_demo_data)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
    `);

    const superAdminId = Number(
      insertUser.run(
        process.env.INITIAL_ADMIN_EMAIL || 'admin.ce@hithaldia.ac.in',
        adminHash,
        'System Administrator (HIT CE)',
        '+91-3224-252900',
        roleIds.SUPER_ADMIN,
        ceDeptId,
        1
      ).lastInsertRowid
    );

    const librarianId = Number(
      insertUser.run(
        'librarian.ce@hithaldia.ac.in',
        librarianHash,
        'Subrata Kumar Maity (Departmental Librarian)',
        '+91-3224-252910',
        roleIds.LIBRARIAN,
        ceDeptId,
        1
      ).lastInsertRowid
    );

    // 5. 10 Fictional Faculty Members (first one is also the quick-demo faculty login)
    const facultyUserIds: number[] = [];
    const insertFaculty = db.prepare(`
      INSERT INTO faculty (user_id, employee_id, designation, department_id)
      VALUES (?, ?, ?, ?)
    `);

    DEMO_FACULTY.forEach((f, idx) => {
      const email = idx === 0 ? 'faculty.ce@hithaldia.ac.in' : f.email;
      const uId = Number(
        insertUser.run(email, facultyHash, f.name, f.phone, roleIds.FACULTY, ceDeptId, 1).lastInsertRowid
      );
      insertFaculty.run(uId, f.empId, f.designation, ceDeptId);
      facultyUserIds.push(uId);
    });

    // 6. 20 Fictional Students (first one is also the quick-demo student login)
    const studentUserIds: number[] = [];
    const insertStudent = db.prepare(`
      INSERT INTO students (user_id, registration_number, programme, semester, academic_session, department_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    DEMO_STUDENTS.forEach((s, idx) => {
      const email = idx === 0 ? 'student.ce@hithaldia.ac.in' : s.email;
      const uId = Number(
        insertUser.run(email, studentHash, s.name, s.phone, roleIds.STUDENT, ceDeptId, 1).lastInsertRowid
      );
      insertStudent.run(uId, s.reg, s.prog, s.sem, s.session, ceDeptId);
      studentUserIds.push(uId);
    });

    // 7. Categories
    const categoryMap = new Map<string, number>();
    const insertCategory = db.prepare(
      'INSERT INTO categories (name, code, description, is_standard) VALUES (?, ?, ?, ?)'
    );
    for (const cat of CIVIL_CATEGORIES) {
      const res = insertCategory.run(cat.name, cat.code, cat.description, cat.isStandard ? 1 : 0);
      categoryMap.set(cat.name, Number(res.lastInsertRowid));
    }

    // 8. 100 Fictional Civil Engineering Book Titles & 150 Physical Copies
    const authorMap = new Map<string, number>();
    const publisherMap = new Map<string, number>();
    const insertAuthor = db.prepare('INSERT INTO authors (name, biography) VALUES (?, ?)');
    const insertPublisher = db.prepare('INSERT INTO publishers (name, city, country) VALUES (?, ?, ?)');
    const insertBook = db.prepare(`
      INSERT INTO books (
        book_code, isbn, title, subtitle, author_id, publisher_id, edition, publication_year,
        language, subject, category_id, description, keywords, archived, is_demo_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'English', ?, ?, ?, ?, 0, 1)
    `);
    const insertCopy = db.prepare(`
      INSERT INTO book_copies (
        accession_number, book_id, copy_number, acquisition_date, purchase_price_inr,
        supplier, invoice_number, funding_source, shelf_number, rack_number,
        physical_condition, status, remarks, is_demo_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const insertBarcode = db.prepare('INSERT INTO barcodes (book_copy_id, format, value) VALUES (?, ?, ?)');
    const insertQr = db.prepare('INSERT INTO qr_codes (book_copy_id, payload) VALUES (?, ?)');

    const suppliers = ['Kolkata Academic Book House', 'Eastern Technical Distributors', 'Vidyasagar Engineering Books', 'Haldia Scholarly Press'];
    const fundingSources = ['Departmental Annual Grant', 'AICTE Modernization Fund', 'Institute Library Budget', 'TEQIP Reference Grant'];

    let accSeq = 0;
    const bookIds: number[] = [];
    const copyIds: Array<{ id: number; bookId: number; accession: string; title: string }> = [];

    DEMO_BOOK_CATALOGUE.forEach((item, index) => {
      let authorId = authorMap.get(item.author);
      if (!authorId) {
        authorId = Number(insertAuthor.run(item.author, 'Civil Engineering Academic Author (Sample Record)').lastInsertRowid);
        authorMap.set(item.author, authorId);
      }

      let publisherId = publisherMap.get(item.publisher);
      if (!publisherId) {
        publisherId = Number(insertPublisher.run(item.publisher, 'Kolkata / New Delhi', 'India').lastInsertRowid);
        publisherMap.set(item.publisher, publisherId);
      }

      const catId = categoryMap.get(item.category) ?? categoryMap.get('General Engineering')!;
      const bookCode = `CE-BK-${String(index + 1).padStart(3, '0')}`;
      const isbn = `978-81-${String(200 + (index % 79)).padStart(3, '0')}-${String(1000 + index * 17).slice(0, 4)}-${index % 10}`;

      const bookId = Number(
        insertBook.run(
          bookCode,
          isbn,
          item.title,
          item.subtitle || `Departmental Reference Edition – ${item.subject}`,
          authorId,
          publisherId,
          item.edition,
          item.year,
          item.subject,
          catId,
          `[Sample Data] Comprehensive Civil Engineering academic resource covering ${item.subject} (${item.keywords}).`,
          item.keywords
        ).lastInsertRowid
      );
      bookIds.push(bookId);

      // First 50 titles get 2 copies, remaining 50 titles get 1 copy => exactly 150 physical book copies!
      const copiesCount = index < 50 ? 2 : 1;
      for (let c = 1; c <= copiesCount; c++) {
        accSeq += 1;
        const accessionNumber = formatAccessionNumber({
          prefix: 'HIT-CE',
          yearFormat: 'CALENDAR',
          year: 2026,
          sequence: accSeq,
        });
        const monthOffset = (accSeq % 10) + 1;
        const dayOffset = ((accSeq * 3) % 26) + 1;
        const acqDate = `2026-${String(monthOffset).padStart(2, '0')}-${String(dayOffset).padStart(2, '0')}`;
        const shelfNumber = `S-${String(((index % 12) + 1)).padStart(2, '0')}`;
        const rackNumber = `R-${String(((c + index) % 6) + 1).padStart(2, '0')}`;

        // Assign a few copies realistic maintenance / lost / damaged statuses for dashboard completeness
        let status = 'AVAILABLE';
        let condition = 'Good';
        let remarks = 'Sample accession register entry';
        if (accSeq === 146 || accSeq === 147) {
          status = 'UNDER_MAINTENANCE';
          condition = 'Fair - Rebinding';
          remarks = 'Sent for spine rebinding';
        } else if (accSeq === 148) {
          status = 'DAMAGED';
          condition = 'Damaged - Water Stain';
          remarks = 'Water damage noted during shelf audit';
        } else if (accSeq === 149) {
          status = 'LOST';
          condition = 'Lost';
          remarks = 'Reported lost; replacement initiated';
        } else if (accSeq === 150) {
          status = 'RESERVED';
          condition = 'Excellent';
          remarks = 'Held at issue desk for reservation pickup';
        }

        const copyId = Number(
          insertCopy.run(
            accessionNumber,
            bookId,
            c,
            acqDate,
            item.price,
            suppliers[accSeq % suppliers.length],
            `INV-HIT-CE-2026-${String(100 + (accSeq % 45))}`,
            fundingSources[accSeq % fundingSources.length],
            shelfNumber,
            rackNumber,
            condition,
            status,
            remarks
          ).lastInsertRowid
        );

        insertBarcode.run(copyId, 'CODE128', accessionNumber);
        insertQr.run(
          copyId,
          buildQrPayload({ accessionNumber, bookCode, copyNumber: c })
        );

        copyIds.push({ id: copyId, bookId, accession: accessionNumber, title: item.title });
      }
    });

    // Save Accession Sequence counter at 150
    db.prepare(
      `INSERT INTO accession_sequences (prefix, year_format, current_year, last_number) VALUES ('HIT-CE', 'CALENDAR', 2026, ?)`
    ).run(accSeq);

    // 9. 30 Sample Circulation Transactions (10 Returned, 10 Active On-Time, 10 Overdue with Fines!)
    const now = new Date();
    const daysAgoIso = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();
    const daysFromNowIso = (d: number) => new Date(now.getTime() + d * 86400000).toISOString();

    const insertIssue = db.prepare(`
      INSERT INTO book_issues (
        receipt_no, book_copy_id, borrower_id, issued_by_id, issue_date, due_date, status, renewal_count, remarks, is_demo_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const insertReturn = db.prepare(`
      INSERT INTO book_returns (
        book_issue_id, return_receipt, return_date, overdue_days, fine_amount_inr, condition_note, processed_by_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFine = db.prepare(`
      INSERT INTO fines (
        book_issue_id, user_id, overdue_days, amount_inr, paid_amount_inr, waived_amount_inr, status, waiver_reason, is_demo_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const insertFinePay = db.prepare(`
      INSERT INTO fine_payments (fine_id, receipt_number, amount_paid_inr, payment_method, collected_by_id, paid_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const updateCopyStatus = db.prepare('UPDATE book_copies SET status = ? WHERE id = ?');

    // 9A: 10 Returned Historical Transactions (spread across recent months for rich Recharts monthly charts)
    for (let i = 0; i < 10; i++) {
      const copy = copyIds[i];
      const borrowerId = i < 7 ? studentUserIds[i] : facultyUserIds[i - 7];
      const issuedDaysAgo = 25 + i * 16;
      const dueDaysAgo = issuedDaysAgo - 14;
      const returnedDaysAgo = dueDaysAgo + (i % 3 === 0 ? -4 : 2); // some returned late, some early
      const issueId = Number(
        insertIssue.run(
          `ISS-2026-${String(i + 1).padStart(4, '0')}`,
          copy.id,
          borrowerId,
          librarianId,
          daysAgoIso(issuedDaysAgo),
          daysAgoIso(dueDaysAgo),
          'RETURNED',
          i % 4 === 0 ? 1 : 0,
          'Sample historical transaction'
        ).lastInsertRowid
      );

      const lateDays = i % 3 === 0 ? 4 : 0;
      const fineAmt = lateDays * 5;
      insertReturn.run(
        issueId,
        `RET-2026-${String(i + 1).padStart(4, '0')}`,
        daysAgoIso(Math.max(1, returnedDaysAgo)),
        lateDays,
        fineAmt,
        'Returned in good physical condition',
        librarianId
      );

      if (fineAmt > 0) {
        const fId = Number(
          insertFine.run(issueId, borrowerId, lateDays, fineAmt, fineAmt, 0, 'PAID', null).lastInsertRowid
        );
        insertFinePay.run(
          fId,
          `FINE-2026-${String(i + 1).padStart(4, '0')}`,
          fineAmt,
          'Cash / Departmental Counter',
          librarianId,
          daysAgoIso(Math.max(1, returnedDaysAgo))
        );
      }
    }

    // 9B: 10 Active On-Time Loans (copies index 10..19)
    for (let i = 0; i < 10; i++) {
      const copy = copyIds[10 + i];
      const borrowerId = i < 6 ? studentUserIds[i % studentUserIds.length] : facultyUserIds[(i - 6) % facultyUserIds.length];
      insertIssue.run(
        `ISS-2026-${String(11 + i).padStart(4, '0')}`,
        copy.id,
        borrowerId,
        librarianId,
        daysAgoIso(2 + (i % 6)),
        daysFromNowIso(4 + (i % 10)),
        'ISSUED',
        0,
        'Active departmental loan (Sample)'
      );
      updateCopyStatus.run('ISSUED', copy.id);
    }

    // 9C: 10 Overdue Examples (copies index 20..29) with Fines (Pending, Partially Paid, Waived)
    for (let i = 0; i < 10; i++) {
      const copy = copyIds[20 + i];
      const borrowerId = i < 8 ? studentUserIds[i] : facultyUserIds[i - 8];
      const overdueDays = 4 + i * 3;
      const issueId = Number(
        insertIssue.run(
          `ISS-2026-${String(21 + i).padStart(4, '0')}`,
          copy.id,
          borrowerId,
          librarianId,
          daysAgoIso(overdueDays + 14),
          daysAgoIso(overdueDays),
          'OVERDUE',
          0,
          'Overdue sample circulation record'
        ).lastInsertRowid
      );
      updateCopyStatus.run('ISSUED', copy.id);

      const fineAmount = Math.min(overdueDays * 5, 500);
      if (i === 8) {
        const partial = Math.round(fineAmount / 2);
        const fId = Number(
          insertFine.run(issueId, borrowerId, overdueDays, fineAmount, partial, 0, 'PARTIALLY_PAID', null).lastInsertRowid
        );
        insertFinePay.run(
          fId,
          `FINE-2026-P${i + 1}`,
          partial,
          'Cash / Departmental Counter',
          librarianId,
          daysAgoIso(1)
        );
      } else if (i === 9) {
        insertFine.run(issueId, borrowerId, overdueDays, fineAmount, 0, fineAmount, 'WAIVED', 'Medical leave approved by HOD');
      } else {
        insertFine.run(issueId, borrowerId, overdueDays, fineAmount, 0, 0, 'PENDING', null);
      }
    }

    // 10. Sample Reservations
    const insertRes = db.prepare(`
      INSERT INTO reservations (book_id, user_id, status, reserved_at, expires_at, is_demo_data)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    const insertResQueue = db.prepare(`
      INSERT INTO reservation_queue (reservation_id, book_id, position) VALUES (?, ?, ?)
    `);

    const sampleResSpecs = [
      { bookIdx: 5, userId: studentUserIds[0], status: 'ACTIVE', pos: 1 },
      { bookIdx: 5, userId: studentUserIds[1], status: 'ACTIVE', pos: 2 },
      { bookIdx: 12, userId: studentUserIds[2], status: 'READY', pos: 1 },
      { bookIdx: 18, userId: facultyUserIds[0], status: 'ACTIVE', pos: 1 },
      { bookIdx: 24, userId: studentUserIds[3], status: 'ACTIVE', pos: 1 },
      { bookIdx: 30, userId: facultyUserIds[1], status: 'FULFILLED', pos: 1 },
    ];
    for (const r of sampleResSpecs) {
      const rId = Number(
        insertRes.run(
          bookIds[r.bookIdx],
          r.userId,
          r.status,
          daysAgoIso(2),
          daysFromNowIso(2)
        ).lastInsertRowid
      );
      insertResQueue.run(rId, bookIds[r.bookIdx], r.pos);
    }

    // 11. 15 Digital Resources (with real downloadable sample files in uploads/digital/)
    const digitalDir = path.resolve(process.cwd(), 'uploads', 'digital');
    fs.mkdirSync(digitalDir, { recursive: true });
    const insertDigital = db.prepare(`
      INSERT INTO digital_resources (
        title, author, category, subject, semester, academic_year, description,
        file_name, file_path, file_size_bytes, mime_type, access_level, uploaded_by_id, download_count, is_demo_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ALL_AUTHENTICATED', ?, ?, 1)
    `);

    DEMO_DIGITAL_RESOURCES.forEach((resItem, idx) => {
      const safeFileName = `hit-ce-resource-${String(idx + 1).padStart(2, '0')}.txt`;
      const absPath = path.join(digitalDir, safeFileName);
      const sampleContent = [
        'HALDIA INSTITUTE OF TECHNOLOGY',
        'DEPARTMENT OF CIVIL ENGINEERING – DIGITAL LIBRARY',
        '============================================================',
        `Resource Title : ${resItem.title}`,
        `Author / Source: ${resItem.author}`,
        `Category       : ${resItem.category}`,
        `Subject        : ${resItem.subject}`,
        `Semester       : ${resItem.semester}`,
        `Academic Year  : ${resItem.year}`,
        '============================================================',
        '',
        'Notice: This is a departmental sample demonstration resource file.',
        resItem.desc,
        '',
        'Authorized for registered Students and Faculty of Haldia Institute of Technology.',
      ].join('\n');

      fs.writeFileSync(absPath, sampleContent, 'utf-8');
      const stat = fs.statSync(absPath);

      insertDigital.run(
        resItem.title,
        resItem.author,
        resItem.category,
        resItem.subject,
        resItem.semester,
        resItem.year,
        resItem.desc,
        safeFileName,
        `uploads/digital/${safeFileName}`,
        stat.size,
        'text/plain',
        idx % 2 === 0 ? librarianId : facultyUserIds[idx % facultyUserIds.length],
        12 + idx * 7
      );
    });

    // 12. 10 Acquisition Requests
    const insertAcq = db.prepare(`
      INSERT INTO acquisition_requests (
        title, author, isbn, publisher, subject, reason, requester_id, priority, status, review_note, is_demo_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    DEMO_ACQUISITION_REQUESTS.forEach((acq, idx) => {
      const requester = idx % 2 === 0 ? facultyUserIds[idx % facultyUserIds.length] : studentUserIds[idx % studentUserIds.length];
      insertAcq.run(
        acq.title,
        acq.author,
        acq.isbn,
        acq.publisher,
        acq.subject,
        acq.reason,
        requester,
        acq.priority,
        acq.status,
        acq.status === 'PENDING' ? null : `Reviewed by Departmental Library Committee (${acq.status})`
      );
    });

    // 13. Notifications
    const insertNotif = db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, is_read)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertNotif.run(superAdminId, 'SYSTEM', 'Departmental Library Initialized', 'HIT Civil Engineering Digital Library is active with 100 sample book titles and 150 accessioned copies.', 0);
    insertNotif.run(librarianId, 'OVERDUE', '10 Overdue Loans Require Follow-Up', 'Ten active sample loans have crossed their due date. Review Overdue Books & Fine Management.', 0);
    insertNotif.run(facultyUserIds[0], 'ACQUISITION', 'Acquisition Request Approved', 'Your request for Alkali-Activated Cements and Concretes has been approved by the Library Committee.', 0);
    insertNotif.run(studentUserIds[0], 'DUE_SOON', 'Upcoming Book Return Reminder', 'You have active issued copies in the Civil Engineering Library. Please verify due dates to avoid overdue fines.', 0);
    insertNotif.run(studentUserIds[0], 'RESERVATION', 'Reservation Queue Confirmed', 'You are #1 in the reservation queue for Experimental Geotechnics and Subsurface Exploration.', 0);

    // 14. Initial Audit Logs
    const insertAudit = db.prepare(`
      INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertAudit.run(superAdminId, 'System Administrator (HIT CE)', 'SUPER_ADMIN', 'SYSTEM_SEED', 'DATABASE', 'init', 'Initialized HIT Civil Engineering Digital Library with 100 titles, 150 copies, 20 students, 10 faculty (Sample Data).', '127.0.0.1');
    insertAudit.run(librarianId, 'Subrata Kumar Maity (Departmental Librarian)', 'LIBRARIAN', 'ACCESSION_REGISTER', 'BOOK_COPY', 'HIT-CE-2026-0001..0150', 'Generated 150 unique sequential accession numbers with Code 128 barcodes and QR codes.', '127.0.0.1');
  });

  console.log('HIT Civil Engineering – Digital Library demonstration dataset seeded successfully.');
}
